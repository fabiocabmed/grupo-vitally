import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_REST_MODEL = 'gemini-2.5-flash';
const PORT = Number(process.env.PORT) || 3000;

interface RawInputPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

function normalizeRestParts(rawParts: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawParts)) return [];
  const normalized: Array<Record<string, unknown>> = [];

  for (const item of rawParts) {
    if (!item || typeof item !== 'object') continue;
    const part = item as RawInputPart;
    if (typeof part.text === 'string' && part.text.length > 0) {
      normalized.push({ text: part.text });
    } else if (part.inlineData?.data && part.inlineData?.mimeType) {
      normalized.push({
        inline_data: {
          mime_type: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      });
    } else if (part.inline_data?.data && part.inline_data?.mime_type) {
      normalized.push({
        inline_data: {
          mime_type: part.inline_data.mime_type,
          data: part.inline_data.data,
        },
      });
    }
  }

  return normalized;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/gemini/generate', async (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const parts = normalizeRestParts(body.parts);
      const useGoogleSearch = Boolean(body.useGoogleSearch);
      const systemInstruction =
        typeof body.systemInstruction === 'string' && body.systemInstruction.trim()
          ? body.systemInstruction.trim()
          : undefined;

      const localStorageKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      const envFallbackKey = (process.env.GEMINI_API_KEY || '').trim();
      const apiKey = localStorageKey || envFallbackKey;

      if (!apiKey) {
        res.status(400).json({
          error:
            'HTTP 400 (MISSING_API_KEY): Nenhuma GEMINI_API_KEY encontrada no localStorage nem em process.env.GEMINI_API_KEY.',
        });
        return;
      }

      if (parts.length === 0) {
        res.status(400).json({
          error: 'HTTP 400 (INVALID_ARGUMENT): Informe ao menos um item em parts.',
        });
        return;
      }

      const restPayload: Record<string, unknown> = {
        contents: [{ role: 'user', parts }],
      };

      if (useGoogleSearch) {
        restPayload.tools = [{ google_search: {} }];
      }

      if (systemInstruction) {
        restPayload.system_instruction = { parts: [{ text: systemInstruction }] };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_REST_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const apiResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restPayload),
      });

      const rawText = await apiResponse.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }

      if (!apiResponse.ok) {
        const googleErr = (parsed.error && typeof parsed.error === 'object'
          ? parsed.error
          : null) as { code?: number; status?: string; message?: string } | null;
        const statusTag = googleErr?.status ? ` (${googleErr.status})` : '';
        const technicalMessage =
          googleErr?.message || rawText || apiResponse.statusText || 'Erro desconhecido retornado pela API';

        res.status(apiResponse.status).json({
          error: `HTTP ${apiResponse.status}${statusTag}: ${technicalMessage}`,
          googleError: googleErr || rawText,
        });
        return;
      }

      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      const candidate = (candidates[0] || {}) as {
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: { groundingChunks?: unknown[] };
      };
      const text = (candidate.content?.parts || [])
        .map((p) => p.text || '')
        .join('\n')
        .trim();
      const groundingChunks = candidate.groundingMetadata?.groundingChunks || [];

      res.json({ text, groundingChunks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `HTTP 500 (SERVER_FETCH_ERROR): ${msg}` });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Grupo Vitally server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
