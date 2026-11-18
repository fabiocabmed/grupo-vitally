/**
 * Vitally Flow — Copiloto de Prospecção Enterprise
 * Módulo ES puro (Zero-build / GitHub Pages ready)
 */

import {
  VERTICALS,
  BENNER_CASES,
  DEFAULT_TEMPLATES,
  DEFAULT_PROJECT_CONFIG,
  DEFAULT_KNOWLEDGE_DOC_MD,
  DEFAULT_ACCOUNTS,
  DEFAULT_PLAYBOOK_RULES,
} from './data-defaults.js';

const VF_STORAGE = {
  PROJECTS: 'vitally_flow_projects',
  ACTIVE_PROJECT_ID: 'vitally_flow_active_project_id',
  ACCOUNTS: 'vitally_flow_v2_accounts',
  ACTIVE_LEAD_ID: 'vitally_flow_v2_active_lead',
  STATS: 'vitally_flow_v2_stats',
  SCHEDULE: 'vitally_flow_v2_schedule',
  TEMPLATES: 'vitally_flow_v2_templates',
  SCRIPTS: 'vitally_flow_v2_scripts',
  CONFIG: 'vitally_flow_v2_config',
  KNOWLEDGE: 'vitally_flow_v2_knowledge',
  PLAYBOOK_RULES: 'vitally_flow_v2_playbook_rules',
  GEMINI_KEY: 'vitally_flow_gemini_key',
};

const DEFAULT_PROJECT = {
  id: 'benner-juridico',
  name: 'Benner Jurídico',
  description: 'Operação Enterprise B2B · 47 cases oficiais, cadência 3 tentativas e agenda matinal.',
  dailyTarget: 25,
  newTarget: 7,
  followupTarget: 18,
  maxAttempts: 3,
  isDefault: true,
};

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MORNING_MEETING_SLOTS = ['09h30', '10h00', '10h30'];
const AFTERNOON_FOLLOWUP_SLOTS = ['14h30', '15h30', '16h15'];
const MORNING_FOLLOWUP_SLOTS = ['09h30', '10h00', '10h30'];

const vfState = {
  initialized: false,
  stage: 'projects', // 'projects' | 'intake' | 'cockpit'
  supabaseClient: null,
  user: null,
  profile: { role: 'admin_root', allowed_modules: ['sales', 'studio', 'apps'] },
  mode: 'local',

  projects: [DEFAULT_PROJECT],
  activeProject: DEFAULT_PROJECT,
  projectConfig: structuredClone(DEFAULT_PROJECT_CONFIG),
  templates: structuredClone(DEFAULT_TEMPLATES),
  scripts: [],
  knowledgeDocs: [],
  playbookRules: '',
  activeKbDocId: null,

  accounts: [],
  activeAccountId: null,
  activePersona: 'Jurídico',
  activeScriptId: null,
  activeCockpitTab: 'script', // 'script' | 'registro' | 'bitrix' | 'email'
  selectedOutChannel: 'email', // 'email' | 'whatsapp'
  selectedChips: new Set(),

  scriptFlow: {
    nodeId: 's0_main',
    history: [],
    pathNotes: [],
  },

  dailyStats: { date: '', novas: 0, followups: 0 },
  schedule: {}, // { 'YYYY-MM-DD': { count: number } }

  lastBitrixText: '',
  lastMessageSubject: '',
  lastMessageBody: '',
  lastWhatsappText: '',

  recognition: null,
  isRecording: false,
  voiceBaseText: '',
  voiceFinalText: '',
  voiceInterimText: '',

  waRecognition: null,
  isWaRecording: false,
  waVoiceBaseText: '',
  waVoiceFinalText: '',
  waVoiceInterimText: '',
  isProcessingAi: false,
};

let toastTimeoutId = null;
let pendingDeleteKbDocId = null;
const templateModalState = {
  mode: null, // 'new-script' | 'edit-script' | 'edit-email'
  scriptId: null,
  emailStage: null, // 1 | 2 | 3
};

// ==========================================================================
// Utilities
// ==========================================================================
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message = 'Copiado!') {
  const toast = document.getElementById('vitally-toast');
  const textEl = document.getElementById('vitally-toast-text');
  if (!toast || !textEl) return;
  textEl.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => toast.classList.add('hidden'), 2600);
}

async function copyText(text, labelEl = null, defaultText = 'Copiar') {
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('fallback');
    }
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    }
    document.body.removeChild(area);
  }
  if (labelEl) {
    labelEl.textContent = 'Copiado!';
    setTimeout(() => {
      labelEl.textContent = defaultText;
    }, 1800);
  }
  showToast('Copiado!');
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDayLabel(date) {
  return `${WEEKDAYS_PT[date.getDay()]} ${formatShortDate(date)}`;
}

function formatNowTimestamp() {
  const now = new Date();
  return `${formatShortDate(now)} - ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
}

function addBusinessDays(startDate, businessDaysToAdd) {
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  let added = 0;
  while (added < businessDaysToAdd) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return cursor;
}

function getNextBusinessDays(count = 6) {
  const days = [];
  const cursor = new Date();
  while (days.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      days.push({
        date: new Date(cursor),
        iso: toIsoDate(cursor),
        label: formatDayLabel(cursor),
      });
    }
  }
  return days;
}

function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(str || ''));
}

function isCloudActive() {
  return Boolean(vfState.supabaseClient && vfState.mode === 'cloud');
}

function isAdminRoot() {
  return vfState.profile?.role === 'admin_root';
}

function getGeminiKey() {
  return (
    (typeof window !== 'undefined' && window.__VITALLY_GEMINI_KEY__) ||
    localStorage.getItem(VF_STORAGE.GEMINI_KEY) ||
    ''
  ).trim();
}

function projectStorageKey(baseKey) {
  const pid = vfState.activeProject?.id || 'benner-juridico';
  return pid === 'benner-juridico' ? baseKey : `${baseKey}_${pid}`;
}

function getProjectLimits() {
  const dailyTarget = Math.max(1, Number(vfState.projectConfig.dailyTarget ?? vfState.activeProject?.dailyTarget ?? 25));
  const newTarget = Math.max(0, Number(vfState.projectConfig.newTarget ?? vfState.activeProject?.newTarget ?? 7));
  const followupTarget = Math.max(1, dailyTarget - newTarget);
  const maxAttempts = Math.max(1, Number(vfState.projectConfig.maxAttempts ?? vfState.activeProject?.maxAttempts ?? 3));
  return { dailyTarget, newTarget, followupTarget, maxAttempts };
}

// ==========================================================================
// Automatic Follow-up Date & Turn Alternation Calculator
// ==========================================================================
function calculateNextFollowUp(attemptNumber = 1) {
  const { followupTarget } = getProjectLimits();
  const now = new Date();
  const isMorningNow = now.getHours() < 12;
  const targetTurn = isMorningNow ? 'tarde' : 'manha';
  const slots = targetTurn === 'tarde' ? AFTERNOON_FOLLOWUP_SLOTS : MORNING_FOLLOWUP_SLOTS;

  // Se ligou de manhã -> sugere tarde (hoje se ainda há capacidade, ou D+2 úteis em turno oposto)
  const minBusinessDays = attemptNumber <= 1 ? (isMorningNow ? 0 : 2) : 2;

  let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (minBusinessDays === 0) {
    // Ensure today is a weekday; otherwise move to next business day
    if (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate = addBusinessDays(candidate, 1);
    }
  } else {
    candidate = addBusinessDays(candidate, minBusinessDays);
  }

  for (let i = 0; i < 30; i += 1) {
    const iso = toIsoDate(candidate);
    const entry = vfState.schedule[iso] || { count: 0 };
    if (entry.count < followupTarget) {
      const slot = slots[entry.count % slots.length];
      const dayText = iso === toIsoDate(now) ? `Hoje (${formatDayLabel(candidate)})` : formatDayLabel(candidate);
      return {
        iso,
        slot,
        turn: targetTurn,
        label: `${dayText} às ${slot} (turno oposto: ${targetTurn === 'tarde' ? 'tarde' : 'manhã'})`,
      };
    }
    candidate = addBusinessDays(candidate, 1);
  }

  const fallback = addBusinessDays(now, 2);
  return {
    iso: toIsoDate(fallback),
    slot: slots[0],
    turn: targetTurn,
    label: `${formatDayLabel(fallback)} às ${slots[0]} (turno oposto: ${targetTurn === 'tarde' ? 'tarde' : 'manhã'})`,
  };
}

function commitFollowUpSchedule(isoDate) {
  if (!isoDate) return;
  const current = vfState.schedule[isoDate] || { count: 0 };
  vfState.schedule[isoDate] = { count: current.count + 1 };
  localStorage.setItem(projectStorageKey(VF_STORAGE.SCHEDULE), JSON.stringify(vfState.schedule));
}

// ==========================================================================
// Local Persistence & Normalization
// ==========================================================================
function loadLocalProjectState() {
  const pid = vfState.activeProject?.id || 'benner-juridico';
  const todayIso = toIsoDate(new Date());
  vfState.activeScriptId = null;

  try {
    const rawCfg = localStorage.getItem(projectStorageKey(VF_STORAGE.CONFIG));
    vfState.projectConfig = rawCfg
      ? { ...structuredClone(DEFAULT_PROJECT_CONFIG), ...JSON.parse(rawCfg) }
      : {
          ...structuredClone(DEFAULT_PROJECT_CONFIG),
          dailyTarget: vfState.activeProject?.dailyTarget ?? 25,
          newTarget: vfState.activeProject?.newTarget ?? 7,
          followupTarget: vfState.activeProject?.followupTarget ?? 18,
          maxAttempts: vfState.activeProject?.maxAttempts ?? 3,
        };
  } catch {
    vfState.projectConfig = structuredClone(DEFAULT_PROJECT_CONFIG);
  }

  try {
    const rawTpl = localStorage.getItem(projectStorageKey(VF_STORAGE.TEMPLATES));
    vfState.templates = rawTpl
      ? { ...structuredClone(DEFAULT_TEMPLATES), ...JSON.parse(rawTpl) }
      : structuredClone(DEFAULT_TEMPLATES);
  } catch {
    vfState.templates = structuredClone(DEFAULT_TEMPLATES);
  }

  try {
    const rawScripts = localStorage.getItem(projectStorageKey(VF_STORAGE.SCRIPTS));
    if (rawScripts !== null) {
      const parsedScripts = JSON.parse(rawScripts);
      vfState.scripts = Array.isArray(parsedScripts) ? parsedScripts : [];
    } else if (Array.isArray(vfState.activeProject?.scripts)) {
      vfState.scripts = structuredClone(vfState.activeProject.scripts);
    } else {
      vfState.scripts = [];
    }
  } catch {
    vfState.scripts = [];
  }

  try {
    const rawKb = localStorage.getItem(projectStorageKey(VF_STORAGE.KNOWLEDGE));
    if (rawKb) {
      vfState.knowledgeDocs = JSON.parse(rawKb);
    } else if (pid === 'benner-juridico' || vfState.activeProject?.isDefault) {
      vfState.knowledgeDocs = [
        {
          id: 'doc-benner-oficial',
          title: 'catalogo-47-cases-benner.md',
          content: DEFAULT_KNOWLEDGE_DOC_MD,
        },
      ];
    } else {
      vfState.knowledgeDocs = [];
    }
  } catch {
    vfState.knowledgeDocs = [];
  }

  try {
    const rawRules = localStorage.getItem(projectStorageKey(VF_STORAGE.PLAYBOOK_RULES));
    if (rawRules !== null) {
      vfState.playbookRules = rawRules;
    } else if (typeof vfState.activeProject?.playbookRules === 'string' && vfState.activeProject.playbookRules.trim()) {
      vfState.playbookRules = vfState.activeProject.playbookRules;
    } else if (pid === 'benner-juridico' || vfState.activeProject?.isDefault) {
      vfState.playbookRules = DEFAULT_PLAYBOOK_RULES;
    } else {
      vfState.playbookRules = '';
    }
  } catch {
    vfState.playbookRules =
      pid === 'benner-juridico' || vfState.activeProject?.isDefault ? DEFAULT_PLAYBOOK_RULES : '';
  }

  try {
    const rawAcc = localStorage.getItem(projectStorageKey(VF_STORAGE.ACCOUNTS));
    if (rawAcc) {
      vfState.accounts = JSON.parse(rawAcc);
    } else {
      vfState.accounts =
        pid === 'benner-juridico' || vfState.activeProject?.isDefault
          ? structuredClone(DEFAULT_ACCOUNTS)
          : [];
    }
  } catch {
    vfState.accounts =
      pid === 'benner-juridico' || vfState.activeProject?.isDefault
        ? structuredClone(DEFAULT_ACCOUNTS)
        : [];
  }

  const savedLeadId = localStorage.getItem(projectStorageKey(VF_STORAGE.ACTIVE_LEAD_ID));
  const hasSaved = vfState.accounts.some((a) => a.id === savedLeadId);
  vfState.activeAccountId = hasSaved ? savedLeadId : vfState.accounts[0]?.id || null;

  try {
    const rawStats = localStorage.getItem(projectStorageKey(VF_STORAGE.STATS));
    const parsedStats = rawStats ? JSON.parse(rawStats) : null;
    if (parsedStats && parsedStats.date === todayIso) {
      vfState.dailyStats = {
        date: todayIso,
        novas: Number(parsedStats.novas) || 0,
        followups: Number(parsedStats.followups) || 0,
      };
    } else {
      vfState.dailyStats = { date: todayIso, novas: 0, followups: 0 };
    }
  } catch {
    vfState.dailyStats = { date: todayIso, novas: 0, followups: 0 };
  }

  try {
    const rawSched = localStorage.getItem(projectStorageKey(VF_STORAGE.SCHEDULE));
    vfState.schedule = rawSched ? JSON.parse(rawSched) : {};
  } catch {
    vfState.schedule = {};
  }
}

function saveAccountsLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.ACCOUNTS), JSON.stringify(vfState.accounts));
  if (vfState.activeAccountId) {
    localStorage.setItem(projectStorageKey(VF_STORAGE.ACTIVE_LEAD_ID), vfState.activeAccountId);
  }
}

function saveStatsLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.STATS), JSON.stringify(vfState.dailyStats));
}

function saveConfigLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.CONFIG), JSON.stringify(vfState.projectConfig));
}

function syncTemplateTelepromptersFromScripts() {
  const jur = vfState.scripts.find((s) => (s.name || '').trim().toLowerCase() === 'jurídico' || (s.name || '').trim().toLowerCase() === 'juridico');
  const fin = vfState.scripts.find((s) => (s.name || '').trim().toLowerCase() === 'financeiro');
  vfState.templates.teleprompterJuridico = jur ? jur.content : '';
  vfState.templates.teleprompterFinanceiro = fin ? fin.content : '';
}

function saveTemplatesLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.TEMPLATES), JSON.stringify(vfState.templates));
}

function saveScriptsLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.SCRIPTS), JSON.stringify(vfState.scripts));
  if (vfState.activeProject) {
    vfState.activeProject.scripts = structuredClone(vfState.scripts);
    localStorage.setItem(VF_STORAGE.PROJECTS, JSON.stringify(vfState.projects));
  }
}

function saveKnowledgeLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.KNOWLEDGE), JSON.stringify(vfState.knowledgeDocs));
}

function savePlaybookRulesLocal() {
  localStorage.setItem(projectStorageKey(VF_STORAGE.PLAYBOOK_RULES), vfState.playbookRules || '');
  if (vfState.activeProject) {
    vfState.activeProject.playbookRules = vfState.playbookRules || '';
    localStorage.setItem(VF_STORAGE.PROJECTS, JSON.stringify(vfState.projects));
  }
}

function getActiveAccount() {
  return vfState.accounts.find((a) => a.id === vfState.activeAccountId) || null;
}

// ==========================================================================
// Supabase Sync (vf_projects, vf_knowledge_docs, vf_leads, vf_interactions, vf_daily_stats)
// ==========================================================================
function mapDbLeadToAccount(row) {
  const statusRaw = String(row.status || 'ativo').toLowerCase();
  const normalizedStatus = statusRaw === 'descartado' ? 'descartado' : statusRaw === 'reuniao_marcada' ? 'reuniao_marcada' : 'ativo';
  const vertical = VERTICALS.includes(row.vertical) ? row.vertical : VERTICALS[0];

  return {
    id: String(row.id),
    empresa: row.empresa || row.company_name || row.name || 'Empresa',
    vertical,
    funcionariosEstimados: parseEmployeeEstimate(row.funcionarios_estimados ?? row.employees_count, row.funcionarios_texto || ''),
    funcionariosTexto: row.funcionarios_texto || row.employees_text || '',
    processosTexto: row.processos_texto || row.processosTexto || '',
    icpStatus: row.icp_status || '',
    resumo: row.resumo || row.summary || row.contexto || '',
    decisor: isMissingDecisorName(row.decisor || row.decision_maker || row.contact_name)
      ? ''
      : (row.decisor || row.decision_maker || row.contact_name || ''),
    cargo: row.cargo || row.role || row.title || '',
    persona: row.persona === 'Financeiro' ? 'Financeiro' : 'Jurídico',
    email: row.email || '',
    telefone: row.telefone || row.phone || '',
    sistemaAtual: filterRealEnterpriseSystem(row.sistema_atual || row.current_system || ''),
    personasIdentificadas: Array.isArray(row.personas_identificadas)
      ? row.personas_identificadas
      : [],
    contexto: row.contexto || row.context || row.notes || '',
    cases: Array.isArray(row.cases)
      ? row.cases
      : Array.isArray(row.selected_cases)
        ? row.selected_cases
        : (BENNER_CASES[vertical] || []).slice(0, 3),
    tentativa: Number(row.tentativa ?? row.attempt ?? 1),
    status: normalizedStatus,
    lastNote: row.last_note || row.contexto || '',
    proximoPasso: row.proximo_passo || row.next_step || '',
    scriptJuridico: row.script_juridico || '',
    scriptFinanceiro: row.script_financeiro || '',
    dorEspecifica: row.dor_especifica || '',
    ganchoPersonalizado: row.gancho_personalizado || '',
    diretrizExecucao: row.diretriz_execucao || '',
    variaveis: row.variaveis && typeof row.variaveis === 'object' ? row.variaveis : null,
    groundingSources: Array.isArray(row.grounding_sources) ? row.grounding_sources : [],
    historico: Array.isArray(row.historico) ? row.historico : [],
  };
}

async function syncProjectsFromSupabase() {
  let localProjects = [DEFAULT_PROJECT];
  try {
    const saved = localStorage.getItem(VF_STORAGE.PROJECTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) localProjects = parsed;
    }
  } catch {
    // keep default
  }

  if (!isCloudActive()) {
    vfState.projects = localProjects;
    return;
  }

  try {
    const { data, error } = await vfState.supabaseClient
      .from('vf_projects')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      const mapped = data.map((p) => {
        const dailyTarget = Number(p.daily_target ?? p.meta_diaria ?? 25);
        const newTarget = Number(p.new_companies_target ?? p.meta_novas ?? 7);
        const maxAttempts = Number(p.max_attempts ?? p.limite_tentativas ?? 3);
        return {
          id: String(p.id),
          name: p.name || p.title || 'Projeto',
          description: p.description || p.rules || '',
          dailyTarget,
          newTarget,
          followupTarget: Math.max(1, dailyTarget - newTarget),
          maxAttempts,
          scripts: Array.isArray(p.scripts) ? p.scripts : null,
          playbookRules: typeof p.playbook_rules === 'string' ? p.playbook_rules : '',
          isDefault: (p.name || '').toLowerCase() === 'benner jurídico',
        };
      });
      const hasBenner = mapped.some((p) => p.isDefault);
      vfState.projects = hasBenner ? mapped : [DEFAULT_PROJECT, ...mapped];
    } else {
      vfState.projects = localProjects;
      if (!error && isAdminRoot()) {
        const { data: inserted } = await vfState.supabaseClient
          .from('vf_projects')
          .insert({
            name: DEFAULT_PROJECT.name,
            description: DEFAULT_PROJECT.description,
            user_id: vfState.user?.id || null,
          })
          .select('*')
          .maybeSingle();
        if (inserted?.id) {
          vfState.projects = [{ ...DEFAULT_PROJECT, id: String(inserted.id) }];
        }
      }
    }
    localStorage.setItem(VF_STORAGE.PROJECTS, JSON.stringify(vfState.projects));
  } catch {
    vfState.projects = localProjects;
  }
}

async function loadProjectDataFromSupabase(project) {
  if (!isCloudActive() || !project || !isUuid(project.id)) return;

  try {
    // 1. vf_leads
    const { data: leadsData, error: leadsErr } = await vfState.supabaseClient
      .from('vf_leads')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });

    if (!leadsErr && Array.isArray(leadsData) && leadsData.length > 0) {
      // Merge local extra metadata (like scriptJuridico/resumo if DB doesn't have custom columns)
      const localMap = new Map(vfState.accounts.map((a) => [a.id, a]));
      vfState.accounts = leadsData.map((row) => {
        const mapped = mapDbLeadToAccount(row);
        const local = localMap.get(mapped.id);
        return local
          ? {
              ...local,
              ...mapped,
              funcionariosEstimados:
                mapped.funcionariosEstimados ?? local.funcionariosEstimados ?? null,
              funcionariosTexto: mapped.funcionariosTexto || local.funcionariosTexto || '',
              processosTexto: mapped.processosTexto || local.processosTexto || '',
              icpStatus: mapped.icpStatus || local.icpStatus || '',
              resumo: mapped.resumo || local.resumo,
              sistemaAtual: filterRealEnterpriseSystem(mapped.sistemaAtual || local.sistemaAtual),
              personasIdentificadas:
                row.personas_identificadas && mapped.personasIdentificadas.length > 0
                  ? mapped.personasIdentificadas
                  : local.personasIdentificadas || [],
              scriptJuridico: mapped.scriptJuridico || local.scriptJuridico,
              scriptFinanceiro: mapped.scriptFinanceiro || local.scriptFinanceiro,
              dorEspecifica: mapped.dorEspecifica || local.dorEspecifica || '',
              ganchoPersonalizado: mapped.ganchoPersonalizado || local.ganchoPersonalizado || '',
              diretrizExecucao: mapped.diretrizExecucao || local.diretrizExecucao || '',
              variaveis: mapped.variaveis || local.variaveis || null,
              scriptRewrittenByInteraction: Boolean(local.scriptRewrittenByInteraction),
              emailRewrittenByInteraction: Boolean(local.emailRewrittenByInteraction),
              lastEmailSubject: local.lastEmailSubject || '',
              lastEmailBody: local.lastEmailBody || '',
              lastWhatsappBody: local.lastWhatsappBody || '',
              lastBitrixText: local.lastBitrixText || '',
              groundingSources:
                mapped.groundingSources.length > 0 ? mapped.groundingSources : local.groundingSources || [],
            }
          : mapped;
      });
      if (!vfState.accounts.some((a) => a.id === vfState.activeAccountId)) {
        vfState.activeAccountId = vfState.accounts[0]?.id || null;
      }

      // 2. vf_interactions
      const { data: interData } = await vfState.supabaseClient
        .from('vf_interactions')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(150);

      if (Array.isArray(interData) && interData.length > 0) {
        interData.forEach((item) => {
          const target = vfState.accounts.find((a) => a.id === String(item.lead_id));
          if (target) {
            const line = item.summary || item.notes || `${item.channel || 'Ligação'} — ${item.outcome || ''}`;
            if (line && !target.historico.includes(line)) {
              target.historico.push(line);
            }
          }
        });
      }
      saveAccountsLocal();
    }

    if (Array.isArray(project.scripts)) {
      vfState.scripts = structuredClone(project.scripts);
      saveScriptsLocal();
    }

    if (typeof project.playbookRules === 'string' && project.playbookRules.trim()) {
      vfState.playbookRules = project.playbookRules;
      savePlaybookRulesLocal();
    }

    // 3. vf_knowledge_docs (markdown docs + templates + scripts + project_config + playbook_rules)
    const { data: docsData } = await vfState.supabaseClient
      .from('vf_knowledge_docs')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true });

    if (Array.isArray(docsData) && docsData.length > 0) {
      const mdDocs = [];
      docsData.forEach((doc) => {
        if (doc.doc_type === 'templates' || doc.title === 'templates') {
          try {
            const parsed = typeof doc.content === 'string' ? JSON.parse(doc.content) : doc.content;
            if (parsed && typeof parsed === 'object') {
              vfState.templates = { ...structuredClone(DEFAULT_TEMPLATES), ...parsed };
              saveTemplatesLocal();
            }
          } catch {
            // ignore
          }
        } else if (doc.doc_type === 'scripts' || doc.title === 'scripts') {
          try {
            const parsed = typeof doc.content === 'string' ? JSON.parse(doc.content) : doc.content;
            if (Array.isArray(parsed) && !Array.isArray(project.scripts)) {
              vfState.scripts = parsed;
              saveScriptsLocal();
            }
          } catch {
            // ignore
          }
        } else if (doc.doc_type === 'project_config' || doc.title === 'project_config') {
          try {
            const parsed = typeof doc.content === 'string' ? JSON.parse(doc.content) : doc.content;
            if (parsed && typeof parsed === 'object') {
              vfState.projectConfig = { ...structuredClone(DEFAULT_PROJECT_CONFIG), ...parsed };
              saveConfigLocal();
            }
          } catch {
            // ignore
          }
        } else if (doc.doc_type === 'playbook_rules' || doc.title === 'playbook_rules') {
          if (!(typeof project.playbookRules === 'string' && project.playbookRules.trim()) && typeof doc.content === 'string') {
            vfState.playbookRules = doc.content;
            savePlaybookRulesLocal();
          }
        } else {
          mdDocs.push({
            id: String(doc.id),
            title: doc.title || 'documento.md',
            content: typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content, null, 2),
          });
        }
      });

      if (mdDocs.length > 0) {
        vfState.knowledgeDocs = mdDocs;
        saveKnowledgeLocal();
      }
    }

    // 4. vf_daily_stats
    const todayIso = toIsoDate(new Date());
    const { data: statsData } = await vfState.supabaseClient
      .from('vf_daily_stats')
      .select('*')
      .eq('project_id', project.id)
      .eq('stat_date', todayIso)
      .maybeSingle();

    if (statsData) {
      const p = statsData.pace || {};
      const novas = Number(statsData.new_companies_count ?? p.novas?.current ?? p.novas ?? 0);
      const followups = Number(statsData.followups_count ?? p.followups?.current ?? p.followups ?? 0);
      vfState.dailyStats = { date: todayIso, novas, followups };
      saveStatsLocal();
      if (statsData.schedule && typeof statsData.schedule === 'object') {
        vfState.schedule = statsData.schedule;
        localStorage.setItem(projectStorageKey(VF_STORAGE.SCHEDULE), JSON.stringify(vfState.schedule));
      }
    }
  } catch {
    // Graceful local cache fallback
  }
}

async function syncLeadToSupabase(account) {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id) || !account) return;

  const corePayload = {
    project_id: vfState.activeProject.id,
    user_id: vfState.user?.id || null,
    empresa: account.empresa,
    vertical: account.vertical,
    decisor: account.decisor,
    cargo: account.cargo,
    persona: account.persona,
    email: account.email,
    telefone: account.telefone,
    contexto: account.contexto || account.resumo || '',
    cases: account.cases,
    tentativa: account.tentativa,
    status: account.status,
    proximo_passo: account.proximoPasso,
    last_note: account.lastNote,
  };

  try {
    if (isUuid(account.id)) {
      await vfState.supabaseClient.from('vf_leads').update(corePayload).eq('id', account.id);
    } else {
      const { data } = await vfState.supabaseClient
        .from('vf_leads')
        .insert(corePayload)
        .select('id')
        .maybeSingle();
      if (data?.id) {
        const oldId = account.id;
        account.id = String(data.id);
        if (vfState.activeAccountId === oldId) vfState.activeAccountId = account.id;
        saveAccountsLocal();
      }
    }
  } catch {
    // Non-blocking
  }
}

async function logInteractionToSupabase(account, outcome, channel, summary) {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id) || !account) return;
  try {
    await vfState.supabaseClient.from('vf_interactions').insert({
      project_id: vfState.activeProject.id,
      lead_id: isUuid(account.id) ? account.id : null,
      user_id: vfState.user?.id || null,
      channel,
      outcome,
      attempt: account.tentativa,
      summary,
    });
  } catch {
    // Non-blocking
  }
}

async function syncDailyStatsToSupabase() {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return;
  try {
    const todayIso = toIsoDate(new Date());
    const payload = {
      project_id: vfState.activeProject.id,
      user_id: vfState.user?.id || null,
      stat_date: todayIso,
      pace: {
        novas: vfState.dailyStats.novas,
        followups: vfState.dailyStats.followups,
        total: vfState.dailyStats.novas + vfState.dailyStats.followups,
      },
      schedule: vfState.schedule,
    };

    const { error } = await vfState.supabaseClient
      .from('vf_daily_stats')
      .upsert(payload, { onConflict: 'project_id,stat_date' });

    if (error) {
      const { data: existing } = await vfState.supabaseClient
        .from('vf_daily_stats')
        .select('id')
        .eq('project_id', vfState.activeProject.id)
        .eq('stat_date', todayIso)
        .maybeSingle();
      if (existing?.id) {
        await vfState.supabaseClient.from('vf_daily_stats').update(payload).eq('id', existing.id);
      } else {
        await vfState.supabaseClient.from('vf_daily_stats').insert(payload);
      }
    }
  } catch {
    // Non-blocking
  }
}

async function upsertKnowledgeDocInSupabase(docType, title, content, existingId = null) {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return null;
  try {
    const payload = {
      project_id: vfState.activeProject.id,
      user_id: vfState.user?.id || null,
      doc_type: docType,
      title,
      content,
    };

    if (existingId && isUuid(existingId)) {
      const { data } = await vfState.supabaseClient
        .from('vf_knowledge_docs')
        .update(payload)
        .eq('id', existingId)
        .select('id')
        .maybeSingle();
      return data?.id || existingId;
    }

    const { data: found } = await vfState.supabaseClient
      .from('vf_knowledge_docs')
      .select('id')
      .eq('project_id', vfState.activeProject.id)
      .eq('title', title)
      .maybeSingle();

    if (found?.id) {
      await vfState.supabaseClient.from('vf_knowledge_docs').update(payload).eq('id', found.id);
      return String(found.id);
    }

    const { data: inserted } = await vfState.supabaseClient
      .from('vf_knowledge_docs')
      .insert(payload)
      .select('id')
      .maybeSingle();
    return inserted?.id ? String(inserted.id) : null;
  } catch {
    return null;
  }
}

async function syncProjectGoalsToSupabase() {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return;
  await upsertKnowledgeDocInSupabase('project_config', 'project_config', vfState.projectConfig);

  try {
    await vfState.supabaseClient
      .from('vf_projects')
      .update({
        daily_target: vfState.projectConfig.dailyTarget,
        new_companies_target: vfState.projectConfig.newTarget,
        max_attempts: vfState.projectConfig.maxAttempts,
      })
      .eq('id', vfState.activeProject.id);
  } catch {
    // Safe ignore if remote table uses project_config doc
  }
}

async function syncScriptsToSupabase() {
  saveScriptsLocal();
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return;

  try {
    await vfState.supabaseClient
      .from('vf_projects')
      .update({ scripts: vfState.scripts })
      .eq('id', vfState.activeProject.id);
  } catch {
    // Safe ignore if remote vf_projects schema doesn't yet include scripts column
  }

  await upsertKnowledgeDocInSupabase('scripts', 'scripts', vfState.scripts);
}

async function syncPlaybookRulesToSupabase() {
  savePlaybookRulesLocal();
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return;

  try {
    await vfState.supabaseClient
      .from('vf_projects')
      .update({ playbook_rules: vfState.playbookRules || '' })
      .eq('id', vfState.activeProject.id);
  } catch {
    // Safe ignore if remote vf_projects schema doesn't yet include playbook_rules column
  }

  await upsertKnowledgeDocInSupabase('playbook_rules', 'playbook_rules', vfState.playbookRules || '');
}

// ==========================================================================
// Gemini API Helpers (Direct REST API Call for Static Hosting / GitHub Pages)
// ==========================================================================
function normalizeRestParts(rawParts) {
  if (!Array.isArray(rawParts)) return [];
  const normalized = [];
  for (const item of rawParts) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.length > 0) {
      normalized.push({ text: item.text });
    } else if (item.inlineData?.data && item.inlineData?.mimeType) {
      normalized.push({
        inline_data: {
          mime_type: item.inlineData.mimeType,
          data: item.inlineData.data,
        },
      });
    } else if (item.inline_data?.data && item.inline_data?.mime_type) {
      normalized.push({
        inline_data: {
          mime_type: item.inline_data.mime_type,
          data: item.inline_data.data,
        },
      });
    }
  }
  return normalized;
}

async function callGemini({ parts, useGoogleSearch = false, systemInstruction = '' }) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    showToast('Configure sua GEMINI_API_KEY na engrenagem superior.');
    throw new Error(
      'HTTP 400 (MISSING_API_KEY): Nenhuma GEMINI_API_KEY configurada. Clique no ícone de engrenagem no cabeçalho superior para inserir sua chave da API do Google Gemini.'
    );
  }

  const normalizedParts = normalizeRestParts(parts);
  if (normalizedParts.length === 0) {
    throw new Error('HTTP 400 (INVALID_ARGUMENT): Informe ao menos um item em parts.');
  }

  const restPayload = {
    contents: [{ role: 'user', parts: normalizedParts }],
  };

  if (useGoogleSearch) {
    restPayload.tools = [{ google_search: {} }];
  }

  const cleanSystem = typeof systemInstruction === 'string' ? systemInstruction.trim() : '';
  if (cleanSystem) {
    restPayload.system_instruction = { parts: [{ text: cleanSystem }] };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(restPayload),
  });

  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const googleErr = data.error || {};
    const statusTag = googleErr.status ? ` (${googleErr.status})` : '';
    const technicalMessage = googleErr.message || rawText || response.statusText || 'Erro desconhecido retornado pela API do Gemini';
    throw new Error(`HTTP ${response.status}${statusTag}: ${technicalMessage}`);
  }

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = candidates[0] || {};
  const textParts = candidate.content?.parts || [];
  const text = textParts.map((p) => p.text || '').join('\n').trim();
  const groundingChunks = candidate.groundingMetadata?.groundingChunks || [];

  return { text, groundingChunks };
}

function parseJsonFromGeminiText(rawText) {
  const cleaned = String(rawText || '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('A resposta da IA não retornou um JSON estruturado válido.');
    return JSON.parse(match[0]);
  }
}

function getKnowledgeContextText() {
  if (!vfState.knowledgeDocs || vfState.knowledgeDocs.length === 0) {
    return DEFAULT_KNOWLEDGE_DOC_MD;
  }
  return vfState.knowledgeDocs
    .map((d) => `### Documento: ${d.title}\n${d.content}`)
    .join('\n\n')
    .slice(0, 14000);
}

function getEffectivePlaybookRules() {
  const inMemory = (vfState.playbookRules || '').trim();
  if (inMemory) return inMemory;
  try {
    const fromStorage = (localStorage.getItem(projectStorageKey(VF_STORAGE.PLAYBOOK_RULES)) || '').trim();
    if (fromStorage) return fromStorage;
  } catch {
    // ignore
  }
  return (vfState.activeProject?.playbookRules || '').trim();
}

async function syncLatestBrainAndKbBeforeSearch() {
  if (!isCloudActive() || !vfState.activeProject || !isUuid(vfState.activeProject.id)) return;
  try {
    const { data: projRow } = await vfState.supabaseClient
      .from('vf_projects')
      .select('playbook_rules')
      .eq('id', vfState.activeProject.id)
      .maybeSingle();
    if (typeof projRow?.playbook_rules === 'string' && projRow.playbook_rules.trim()) {
      vfState.playbookRules = projRow.playbook_rules;
      savePlaybookRulesLocal();
    }
  } catch {
    // Safe ignore if remote vf_projects schema lacks playbook_rules column
  }

  try {
    const { data: docsData } = await vfState.supabaseClient
      .from('vf_knowledge_docs')
      .select('*')
      .eq('project_id', vfState.activeProject.id)
      .order('created_at', { ascending: true });
    if (Array.isArray(docsData) && docsData.length > 0) {
      const mdDocs = [];
      docsData.forEach((doc) => {
        if (doc.doc_type === 'playbook_rules' || doc.title === 'playbook_rules') {
          if (!vfState.playbookRules?.trim() && typeof doc.content === 'string' && doc.content.trim()) {
            vfState.playbookRules = doc.content;
            savePlaybookRulesLocal();
          }
        } else if (
          doc.doc_type !== 'templates' &&
          doc.title !== 'templates' &&
          doc.doc_type !== 'scripts' &&
          doc.title !== 'scripts' &&
          doc.doc_type !== 'project_config' &&
          doc.title !== 'project_config'
        ) {
          mdDocs.push({
            id: String(doc.id),
            title: doc.title || 'documento.md',
            content: typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content, null, 2),
          });
        }
      });
      if (mdDocs.length > 0) {
        vfState.knowledgeDocs = mdDocs;
        saveKnowledgeLocal();
      }
    }
  } catch {
    // Graceful local cache fallback
  }
}

function parseEmployeeEstimate(rawCount, rawText = '') {
  if (typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0) {
    return Math.round(rawCount);
  }
  const source = `${rawCount ?? ''} ${rawText ?? ''}`.trim().toLowerCase();
  if (!source) return null;

  const milMatch = source.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (milMatch) {
    const val = parseFloat(milMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return Math.round(val * 1000);
  }

  const numMatch = source.match(/(\d{1,3}(?:\.\d{3})+|\d+)/);
  if (numMatch) {
    const cleaned = Number(numMatch[1].replace(/\./g, ''));
    if (Number.isFinite(cleaned) && cleaned > 0) return cleaned;
  }
  return null;
}

function formatCompactEmployees(rawText, count = null) {
  let clean = String(rawText || '').trim();
  if (clean) {
    clean = clean
      .replace(/\b(?:funcion[aá]rios?|colaboradores?|pessoas|empregados?)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[,;:\-–—]+$/g, '')
      .trim();
  }
  if (clean && !/^(?:a\s*confirmar|n[aã]o\s*informado|nao\s*informado|desconhecido|n\/?a)$/i.test(clean)) {
    return clean;
  }
  if (count !== null && Number.isFinite(count) && count > 0) {
    return `~${count.toLocaleString('pt-BR')}`;
  }
  return 'A confirmar';
}

function formatCompactProcesses(rawText) {
  let clean = String(rawText || '').trim();
  if (!clean || /^(?:n[aã]o\s*estimado|nao\s*estimado|a\s*confirmar|n[aã]o\s*informado|nao\s*informado|desconhecido|n\/?a|-+|—+)$/i.test(clean)) {
    return 'Não estimado';
  }
  clean = clean
    .replace(/\b(?:processos?\s+judiciais?|processos?|a[cç][oõ]es\s+judiciais?|a[cç][oõ]es)\b/gi, ' ')
    .replace(/\bpor\s+m[eê]s\b/gi, '/ mês')
    .replace(/\s*\/\s*m[eê]s\b/gi, ' / mês')
    .replace(/\bpor\s+ano\b/gi, '/ ano')
    .replace(/\s*\/\s*ano\b/gi, ' / ano')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,;:\-–—]+|\s*[,;:\-–—]+$/g, '')
    .trim();
  return clean || 'Não estimado';
}

function getAccountIcpStatus(account) {
  if (!account) return { state: 'unknown', count: null, text: 'A confirmar' };
  const count = parseEmployeeEstimate(account.funcionariosEstimados, account.funcionariosTexto);
  const rawText = (account.funcionariosTexto || '').trim();
  const displayText = formatCompactEmployees(rawText, count);
  const explicitStatus = String(account.icpStatus || '').toLowerCase();

  if ((count !== null && count < 1000) || explicitStatus === 'abaixo_icp' || explicitStatus === 'fora_perfil') {
    return { state: 'below', count, text: displayText };
  }
  if ((count !== null && count >= 1000) || explicitStatus === 'validado') {
    return { state: 'validated', count, text: displayText };
  }
  return { state: 'unknown', count, text: displayText };
}

function filterRealEnterpriseSystem(rawSystem) {
  const val = String(rawSystem || '').trim();
  if (!val) return '';

  const enterpriseRegex = /\b(projuris|legal\s*one|espaider|finch|benner|saj|astrea|cpj|lawsoft|ijuris|e-?law|elaw|softplan|kurier|looplex|aurum|themis|sislaw|sap|totvs|protheus|datasul|rm\b|oracle|netsuite|microsoft\s*dynamics|dynamics\s*365|sankhya|senior|salesforce|servicenow|workday|linx|microsiga|infor|siebel)\b/i;
  if (enterpriseRegex.test(val)) {
    return val;
  }

  const genericOrPlaceholderRegex = /\b(excel|power\s*bi|powerbi|sql|pacote\s*office|microsoft\s*office|office|google\s*sheets|sheets|planilha|word|outlook|trello|notion|sharepoint|legado|erp\s*corporativo|gest[aã]o\s*jur[ií]dica\s*interna|sistema\s*interno|a\s*confirmar|n[aã]o\s*informado|nao\s*informado|estimativa|desconhecido|nenhum|manual|propriet[aá]rio|n[aã]o\s*identificado)\b/i;
  if (genericOrPlaceholderRegex.test(val)) {
    return '';
  }

  // If ambiguous generic phrase without an explicit named software/ERP, hide to maintain zero noise
  return '';
}

function buildBrainAnalysisPrompt({
  companyName,
  rawBitrixContext = '',
  existingAccount = null,
  kbContext,
  catalogSummary,
}) {
  const bitrixSection = rawBitrixContext
    ? `\nContexto Bruto colado do card do Bitrix24 (extraia TODOS os nomes de personas, cargos, telefones, e-mails, sistema atual e notas):\n"""\n${rawBitrixContext}\n"""\n`
    : '';

  const existingSection = existingAccount
    ? `\nDados atuais já salvos na conta (preserve telefones, e-mails, contatos e histórico válidos enquanto enriquece e atualiza a análise segundo as regras do Cérebro da IA):\n- Empresa: ${existingAccount.empresa}\n- Vertical atual: ${existingAccount.vertical}\n- Decisor atual: ${existingAccount.decisor || ''} (${existingAccount.cargo || ''})\n- Telefone atual: ${existingAccount.telefone || ''}\n- E-mail atual: ${existingAccount.email || ''}\n- Sistema atual: ${existingAccount.sistemaAtual || ''}\n- Dores/Contexto anterior: ${existingAccount.contexto || existingAccount.resumo || ''}\n- Personas anteriores: ${JSON.stringify(existingAccount.personasIdentificadas || [])}\n`
    : '';

  return `Execute a inteligência comercial para a empresa "${companyName}" utilizando pesquisa web em tempo real (Google Search) e cruzando rigorosamente com os documentos da Base de Conhecimento Markdown abaixo${rawBitrixContext ? ' e com o contexto do Bitrix24' : ''}.
Todas as diretrizes estratégicas, critérios de priorização, tom e regras de saída definidos na instrução de sistema (systemInstruction — Cérebro da IA) têm prioridade máxima.

REGRAS CRÍTICAS DE ICP, SISTEMA ATUAL E ESTIMATIVA DE PROCESSOS:
1. Porte (ICP Enterprise): Pesquise e estime o número total de funcionários da empresa (LinkedIn, site oficial, notícias). Preencha "funcionariosEstimados" com um número inteiro estimado (ou null se impossível estimar), "funcionariosTexto" em formato curto APENAS com o número/faixa sem repetir a palavra funcionários (ex: "~2.500" ou "~420") e "icpStatus": "validado" se 1.000+ funcionários, "abaixo_icp" se menor que 1.000 funcionários (ou porte claramente fora do ICP Enterprise), ou "a_confirmar" se não houver dado confiável.
2. Sistema Atual: Preencha "sistemaAtual" SOMENTE se encontrar menção explícita (em vagas de emprego, notícias, comunicados ou Bitrix24) a um software jurídico específico (ex: ProJuris, Legal One, Espaider, Finch, Benner, SAJ, Astrea, CPJ, Lawsoft, iJuris, E-law) ou ERP específico (ex: SAP, TOTVS, Protheus, Oracle, Microsoft Dynamics, Senior, Sankhya). Se encontrar apenas ferramentas genéricas (Excel, Power BI, SQL, Pacote Office, planilhas) ou não encontrar menção explícita, retorne "" (string vazia).
3. Estimativa de Processos Judiciais: Pesquise na internet e fontes públicas (Jusbrasil, Escavador, relatórios anuais, demonstrações financeiras, notícias ou regras configuradas no Cérebro da IA) o volume estimado mensal de novos processos ou volume ativo de processos judiciais da empresa. Preencha "processosTexto" em formato ultra curto SEM repetir a palavra "processos" (ex: "40 a 60 / mês", "~180 / mês" ou "~1.200 ativos") ou "Não estimado" caso não existam indícios confiáveis.
${bitrixSection}${existingSection}
Base de Conhecimento do Projeto (Markdown):
${kbContext}

Catálogo Oficial dos 47 cases por vertical:
${catalogSummary}

Retorne EXCLUSIVAMENTE um JSON válido (sem comentários ou markdown fora do JSON) contendo todos os blocos estruturados abaixo:
{
  "empresa": "Nome oficial da empresa",
  "vertical": "uma das 9 verticais exatas: ${VERTICALS.join(' | ')}",
  "funcionariosEstimados": 1500,
  "funcionariosTexto": "~1.500",
  "processosTexto": "~180 / mês",
  "icpStatus": "validado",
  "raioXConta": "Resumo executivo conciso da operação conforme o Cérebro da IA",
  "decisor": "Nome completo do executivo/decisor principal (ou vazio "" se não mapeado)",
  "cargo": "Cargo do decisor principal (ou vazio se não mapeado)",
  "persona": "Jurídico" ou "Financeiro",
  "email": "e-mail corporativo principal ou vazio",
  "telefone": "telefone corporativo principal ou vazio",
  "sistemaAtual": "APENAS software jurídico ou ERP explícito encontrado em vagas/notícias/Bitrix, ou vazio",
  "personasIdentificadas": [
    { "nome": "string", "cargo": "string", "perfil": "Jurídico", "telefone": "string ou vazio", "email": "string ou vazio" }
  ],
  "cases": ["2 a 3 clientes reais escolhidos APENAS do catálogo da vertical correspondente acima"],
  "dorPrincipal": "Diagnóstico direto da dor prioritária conectada à Base de Conhecimento",
  "gancho": "Gancho personalizado objetivo para conexão imediata",
  "variaveis": {
    "empresa": "Nome da empresa limpo para encaixar em frases",
    "vertical": "Nome da vertical exata",
    "decisor": "Nome completo do decisor sem abreviações (ou vazio "" se não mapeado)",
    "persona": "Jurídico" ou "Financeiro",
    "case1": "Primeiro case de referência da mesma vertical",
    "case2": "Segundo case de referência da mesma vertical",
    "dor_especifica": "Frase curta da dor específica pronta para encaixar em scripts e e-mails sem abreviações",
    "gancho_personalizado": "Frase curta do gancho personalizado pronta para encaixar em scripts e e-mails sem abreviações"
  }
}`;
}

function feedAccountTemplatesFromProject(account) {
  if (!account) return;
  const { maxAttempts } = getProjectLimits();
  const isBlackout =
    String(account.status || '').toLowerCase() === 'descartado' ||
    Number(account.tentativa || 1) >= maxAttempts;

  const jurScriptObj = vfState.scripts.find(
    (s) => (s.name || '').trim().toLowerCase() === 'jurídico' || (s.name || '').trim().toLowerCase() === 'juridico'
  );
  const finScriptObj = vfState.scripts.find(
    (s) => (s.name || '').trim().toLowerCase() === 'financeiro'
  );

  const jurTpl = jurScriptObj?.content || '';
  const finTpl = finScriptObj?.content || '';

  account.scriptJuridico = jurTpl ? interpolateText(jurTpl, account) : '';
  account.scriptFinanceiro = finTpl ? interpolateText(finTpl, account) : '';
  account.scriptRewrittenByInteraction = false;

  const msgs = buildFallbackMessages(account, isBlackout);
  account.lastEmailSubject = msgs.emailSubject;
  account.lastEmailBody = msgs.emailBody;
  account.lastWhatsappBody = msgs.whatsappBody;
  account.emailRewrittenByInteraction = false;
}

function applyBrainVariablesAndTemplates(account, parsed, sources = [], fallbackCompanyName = '') {
  const rawVars = parsed?.variaveis && typeof parsed.variaveis === 'object' ? parsed.variaveis : {};
  const verticalCandidate = parsed?.vertical || rawVars.vertical || account.vertical;
  const vertical = VERTICALS.includes(verticalCandidate) ? verticalCandidate : (account.vertical || VERTICALS[0]);
  const validCases = BENNER_CASES[vertical] || [];

  const case1 = String(rawVars.case1 || (Array.isArray(parsed?.cases) ? parsed.cases[0] : '') || validCases[0] || '').trim();
  const case2 = String(rawVars.case2 || (Array.isArray(parsed?.cases) ? parsed.cases[1] : '') || validCases[1] || validCases[0] || '').trim();
  const selectedCases = Array.isArray(parsed?.cases) && parsed.cases.length > 0
    ? parsed.cases.slice(0, 3)
    : [case1, case2, validCases[2]].filter(Boolean).slice(0, 3);

  const rawDecisorCandidate = String(parsed?.decisor ?? account.decisor ?? '').trim();
  const decisor = isMissingDecisorName(rawDecisorCandidate) ? '' : rawDecisorCandidate;
  const persona = (parsed?.persona || rawVars.persona || account.persona) === 'Financeiro' ? 'Financeiro' : 'Jurídico';
  const dorEspecifica = String(rawVars.dor_especifica || parsed?.dorPrincipal || parsed?.contexto || account.dorEspecifica || '').trim();
  const ganchoPersonalizado = String(rawVars.gancho_personalizado || parsed?.gancho || account.ganchoPersonalizado || '').trim();
  const raioX = String(parsed?.raioXConta || parsed?.resumo || account.resumo || '').trim();

  const empCount = parseEmployeeEstimate(parsed?.funcionariosEstimados, parsed?.funcionariosTexto || '');
  if (empCount !== null) {
    account.funcionariosEstimados = empCount;
  }
  if (parsed?.funcionariosTexto) {
    account.funcionariosTexto = formatCompactEmployees(parsed.funcionariosTexto, empCount);
  } else if (empCount !== null && !account.funcionariosTexto) {
    account.funcionariosTexto = formatCompactEmployees('', empCount);
  } else if (account.funcionariosTexto) {
    account.funcionariosTexto = formatCompactEmployees(account.funcionariosTexto, empCount);
  }
  if (parsed?.icpStatus) {
    account.icpStatus = String(parsed.icpStatus).trim().toLowerCase();
  } else if (empCount !== null) {
    account.icpStatus = empCount >= 1000 ? 'validado' : 'abaixo_icp';
  }

  const rawProcessos = String(
    parsed?.processosTexto || parsed?.estimativaProcessos || parsed?.processosEstimados || account.processosTexto || ''
  ).trim();
  account.processosTexto = formatCompactProcesses(rawProcessos);

  account.empresa = String(parsed?.empresa || account.empresa || fallbackCompanyName || 'Empresa').trim();
  account.vertical = vertical;
  account.resumo = raioX;
  account.decisor = decisor;
  account.cargo = String(parsed?.cargo || account.cargo || '').trim();
  account.persona = persona;
  if (parsed?.email) account.email = parsed.email;
  if (parsed?.telefone) account.telefone = parsed.telefone;

  if (parsed?.sistemaAtual !== undefined) {
    account.sistemaAtual = filterRealEnterpriseSystem(parsed.sistemaAtual);
  } else {
    account.sistemaAtual = filterRealEnterpriseSystem(account.sistemaAtual);
  }

  if (Array.isArray(parsed?.personasIdentificadas)) {
    const validContacts = parsed.personasIdentificadas.filter((p) => p && String(p.nome || '').trim());
    if (validContacts.length > 0) {
      account.personasIdentificadas = validContacts;
    } else if (!Array.isArray(account.personasIdentificadas)) {
      account.personasIdentificadas = [];
    }
  } else if (!Array.isArray(account.personasIdentificadas)) {
    account.personasIdentificadas = [];
  }

  account.cases = selectedCases.length > 0 ? selectedCases : validCases.slice(0, 3);
  account.dorEspecifica = dorEspecifica;
  account.ganchoPersonalizado = ganchoPersonalizado;
  account.contexto = [dorEspecifica, ganchoPersonalizado].filter(Boolean).join(' · ') || parsed?.contexto || raioX;
  const rawVarDecisor = isMissingDecisorName(rawVars.decisor) ? '' : String(rawVars.decisor || '').trim();
  account.variaveis = {
    empresa: String(rawVars.empresa || account.empresa).trim(),
    vertical,
    decisor: rawVarDecisor || decisor,
    persona,
    case1: case1 || account.cases[0] || '',
    case2: case2 || account.cases[1] || account.cases[0] || '',
    dor_especifica: dorEspecifica,
    gancho_personalizado: ganchoPersonalizado,
  };

  if (Array.isArray(sources) && sources.length > 0) {
    account.groundingSources = sources;
  }

  feedAccountTemplatesFromProject(account);
  return account;
}

async function researchNewCompanyWithGemini(companyName, rawBitrixContext = '') {
  await syncLatestBrainAndKbBeforeSearch();

  const catalogSummary = VERTICALS.map(
    (v) => `- ${v}: ${(BENNER_CASES[v] || []).join(', ')}`
  ).join('\n');

  const kbContext = getKnowledgeContextText();
  const playbookRules = getEffectivePlaybookRules();

  const prompt = buildBrainAnalysisPrompt({
    companyName,
    rawBitrixContext,
    existingAccount: null,
    kbContext,
    catalogSummary,
  });

  const { text, groundingChunks } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: true,
    systemInstruction: playbookRules,
  });

  const parsed = parseJsonFromGeminiText(text);
  const sources = (groundingChunks || [])
    .map((c) => c.web)
    .filter((w) => w && w.uri)
    .slice(0, 4)
    .map((w) => ({ title: w.title || w.uri, uri: w.uri }));

  const newAccount = {
    id: `acc-${Date.now()}`,
    empresa: companyName,
    vertical: VERTICALS[0],
    funcionariosEstimados: null,
    funcionariosTexto: '',
    processosTexto: '',
    icpStatus: '',
    resumo: '',
    decisor: '',
    cargo: '',
    persona: 'Jurídico',
    email: '',
    telefone: '',
    sistemaAtual: '',
    personasIdentificadas: [],
    cases: [],
    contexto: '',
    dorEspecifica: '',
    ganchoPersonalizado: '',
    diretrizExecucao: '',
    variaveis: null,
    tentativa: 1,
    status: 'ativo',
    lastNote: rawBitrixContext
      ? 'Dossiê inicial criado cruzando Bitrix24 + Cérebro da IA.'
      : 'Dossiê inicial criado com Cérebro da IA e pesquisa web.',
    proximoPasso: '',
    scriptJuridico: '',
    scriptFinanceiro: '',
    groundingSources: sources,
    historico: [
      `${formatNowTimestamp()} | Dossiê criado com Cérebro da IA${rawBitrixContext ? ' + contexto Bitrix24' : ''}.`,
    ],
  };

  applyBrainVariablesAndTemplates(newAccount, parsed, sources, companyName);
  return newAccount;
}

async function reanalyzeAccountWithBrain(account) {
  if (!account) return null;
  await syncLatestBrainAndKbBeforeSearch();

  const catalogSummary = VERTICALS.map(
    (v) => `- ${v}: ${(BENNER_CASES[v] || []).join(', ')}`
  ).join('\n');
  const kbContext = getKnowledgeContextText();
  const playbookRules = getEffectivePlaybookRules();

  const prompt = buildBrainAnalysisPrompt({
    companyName: account.empresa,
    rawBitrixContext: '',
    existingAccount: account,
    kbContext,
    catalogSummary,
  });

  const { text, groundingChunks } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: true,
    systemInstruction: playbookRules,
  });

  const parsed = parseJsonFromGeminiText(text);
  const sources = (groundingChunks || [])
    .map((c) => c.web)
    .filter((w) => w && w.uri)
    .slice(0, 4)
    .map((w) => ({ title: w.title || w.uri, uri: w.uri }));

  applyBrainVariablesAndTemplates(account, parsed, sources, account.empresa);

  const histEntry = `${formatNowTimestamp()} | Análise atualizada com Cérebro da IA (${account.vertical}).`;
  account.historico = [histEntry, ...(account.historico || [])].slice(0, 15);
  account.lastNote = 'Análise reprocessada com Cérebro da IA.';
  account.lastBitrixText = buildBitrixOutput(account, account.proximoPasso, histEntry);

  return account;
}

async function mergeBitrixContextWithGemini(existingAccount, rawBitrixContext) {
  await syncLatestBrainAndKbBeforeSearch();
  const kbContext = getKnowledgeContextText().slice(0, 6000);
  const playbookRules = getEffectivePlaybookRules();

  const prompt = `A empresa "${existingAccount.empresa}" (Vertical: ${existingAccount.vertical}, Cases: ${(existingAccount.cases || []).join(', ')}) já existe na base.
O usuário colou um complemento bruto novo vindo do Bitrix24. Mescle esses novos dados com os dados atuais e com a Base de Conhecimento sem perder informações existentes nem histórico, obedecendo integralmente às diretrizes do Cérebro da IA (systemInstruction).

Base de Conhecimento (resumo):
${kbContext}

Dados atuais salvos:
- Decisor atual: ${existingAccount.decisor} (${existingAccount.cargo || ''})
- E-mail atual: ${existingAccount.email || ''}
- Telefone atual: ${existingAccount.telefone || ''}
- Sistema atual: ${existingAccount.sistemaAtual || ''}
- Contexto/Dores atuais: ${existingAccount.contexto || ''}
- Personas atuais: ${JSON.stringify(existingAccount.personasIdentificadas || [])}

Novo texto colado do Bitrix24:
"""
${rawBitrixContext}
"""

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "funcionariosEstimados": 1500,
  "funcionariosTexto": "~1.500",
  "processosTexto": "~180 / mês",
  "icpStatus": "validado",
  "decisor": "decisor principal atualizado",
  "cargo": "cargo atualizado",
  "email": "e-mail principal atualizado",
  "telefone": "telefone principal atualizado",
  "sistemaAtual": "APENAS software jurídico ou ERP explícito encontrado (ou vazio se genérico)",
  "novosContatos": [
    { "nome": "string", "cargo": "string", "perfil": "Jurídico ou Financeiro", "telefone": "string ou vazio", "email": "string ou vazio" }
  ],
  "raioXConta": "Resumo executivo atualizado conforme o Cérebro da IA",
  "dorPrincipal": "dor principal consolidada",
  "gancho": "gancho personalizado atualizado",
  "variaveis": {
    "empresa": "${existingAccount.empresa}",
    "vertical": "${existingAccount.vertical}",
    "decisor": "decisor sem abreviações",
    "persona": "Jurídico" ou "Financeiro",
    "case1": "${(existingAccount.cases || [])[0] || ''}",
    "case2": "${(existingAccount.cases || [])[1] || ''}",
    "dor_especifica": "dor específica curta sem abreviações",
    "gancho_personalizado": "gancho personalizado curto sem abreviações"
  }
}`;

  const { text } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: false,
    systemInstruction: playbookRules,
  });
  const parsed = parseJsonFromGeminiText(text);

  if (Array.isArray(parsed.novosContatos)) {
    if (!Array.isArray(existingAccount.personasIdentificadas)) existingAccount.personasIdentificadas = [];
    parsed.novosContatos.forEach((nc) => {
      if (!nc?.nome) return;
      const existing = existingAccount.personasIdentificadas.find(
        (p) => (p.nome || '').toLowerCase() === nc.nome.toLowerCase()
      );
      if (existing) {
        if (nc.cargo) existing.cargo = nc.cargo;
        if (nc.telefone) existing.telefone = nc.telefone;
        if (nc.email) existing.email = nc.email;
      } else {
        existingAccount.personasIdentificadas.push({
          nome: nc.nome,
          cargo: nc.cargo || 'Contato Bitrix24',
          perfil: nc.perfil === 'Financeiro' ? 'Financeiro' : 'Jurídico',
          telefone: nc.telefone || '',
          email: nc.email || '',
        });
      }
    });
  }

  applyBrainVariablesAndTemplates(existingAccount, parsed, [], existingAccount.empresa);

  existingAccount.historico = [
    `${formatNowTimestamp()} | Contexto do Bitrix24 mesclado com Cérebro da IA.`,
    ...(existingAccount.historico || []),
  ].slice(0, 15);
  return existingAccount;
}

function getProjectSignature() {
  return (vfState.projectConfig.signature || DEFAULT_PROJECT_CONFIG.signature || 'Fábio Medeiros\nBenner Jurídico')
    .replace(/\r\n/g, '\n')
    .trim();
}

function preserveMultilineSignature(bodyText, signature, appendIfMissing = false) {
  let text = String(bodyText || '').replace(/\r\n/g, '\n');
  if (!signature) return text;
  if (text.includes(signature)) return text;

  const lines = signature.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const escapedLines = lines.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const collapsedRegex = new RegExp(escapedLines.join('\\s*(?:—|-|–|,|\\s)+\\s*'), 'g');
    if (collapsedRegex.test(text)) {
      return text.replace(collapsedRegex, signature);
    }
  }

  if (text.includes('Fábio Medeiros — Benner Jurídico')) {
    return text.replace(/Fábio Medeiros\s*—\s*Benner Jurídico/g, signature);
  }

  if (appendIfMissing && text.trim()) {
    return `${text.trimEnd()}\n\n${signature}`;
  }
  return text;
}

function resolveEmailStageForAttempt(prevAttempt, chips = [], isBlackout = false) {
  if (isBlackout) {
    return {
      stageKey: 'email3',
      stageBadge: 'E-mail 3 (Blackout)',
      subjKey: 'email3Subject',
      bodyKey: 'email3Body',
    };
  }
  const emailAlreadySent = Array.isArray(chips) && chips.includes('E-mail enviado');
  if (Number(prevAttempt || 1) <= 1 && !emailAlreadySent) {
    return {
      stageKey: 'email1',
      stageBadge: 'E-mail 1',
      subjKey: 'email1Subject',
      bodyKey: 'email1Body',
    };
  }
  return {
    stageKey: 'email2',
    stageBadge: 'E-mail 2',
    subjKey: 'email2Subject',
    bodyKey: 'email2Body',
  };
}

async function processInteractionWithGemini(
  account,
  rawInput,
  nextAttempt,
  isBlackout,
  nextFollowUp,
  chips = []
) {
  const signature = getProjectSignature();
  const [date1, date2] = getNextBusinessDays(2).map((d) => d.label);
  const kbContext = getKnowledgeContextText().slice(0, 4000);
  const { maxAttempts } = getProjectLimits();
  const prevAttempt = Math.max(1, Number(account?.tentativa || 1));
  const stageMeta = resolveEmailStageForAttempt(prevAttempt, chips, isBlackout);

  const baseEmailSubject = interpolateText(vfState.templates[stageMeta.subjKey] || '', account);
  const baseEmailBody = preserveMultilineSignature(
    interpolateText(vfState.templates[stageMeta.bodyKey] || '', account),
    signature,
    true
  );
  const baseWhatsappBody = preserveMultilineSignature(
    interpolateText(vfState.templates.whatsappPontual || '', account),
    signature,
    true
  );
  const crmTemplate =
    vfState.projectConfig.bitrixActivityTemplate || DEFAULT_PROJECT_CONFIG.bitrixActivityTemplate;
  const recentHistory = Array.isArray(account?.historico) && account.historico.length > 0
    ? account.historico.slice(0, 8).map((h) => `- ${h}`).join('\n')
    : '- Nenhum histórico anterior registrado.';
  const personasSummary = Array.isArray(account?.personasIdentificadas) && account.personasIdentificadas.length > 0
    ? account.personasIdentificadas
        .map((p) => `${p.nome || 'Sem nome'} (${p.cargo || p.perfil || 'Contato'}${p.telefone ? `, Tel: ${p.telefone}` : ''}${p.email ? `, E-mail: ${p.email}` : ''})`)
        .join(' | ')
    : 'Nenhuma persona mapeada ainda.';
  const scriptsSummary = getProjectScriptsList()
    .map((s) => `- ${s.name}: ${(s.content || '').slice(0, 260)}`)
    .join('\n') || '- Nenhum script adicional cadastrado.';

  const prompt = `Você é o copiloto comercial B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Analise TUDO o que ocorreu nesta tentativa de prospecção para a empresa "${account.empresa}" combinando os chips rápidos selecionados, o texto ditado por voz/transcrição, o dossiê completo da conta, o histórico anterior, as diretrizes do Cérebro da IA (systemInstruction) e os templates cadastrados no projeto.

DOSSIÊ ATUAL DA CONTA:
- Empresa: ${account.empresa}
- Vertical: ${account.vertical}
- Funcionários estimados: ${account.funcionariosTexto || 'A confirmar'}
- Processos estimados: ${account.processosTexto || 'Não estimado'}
- Decisor atual: ${isMissingDecisorName(account.decisor) ? '[Nome do Lead] (não mapeado)' : account.decisor} (${account.cargo || 'Cargo não informado'})
- Telefone atual: ${account.telefone || 'Não informado'}
- E-mail atual: ${account.email || 'Não informado'}
- Personas mapeadas: ${personasSummary}
- Persona ativa no teleprompter: ${vfState.activePersona}
- Sistema atual conhecido: ${account.sistemaAtual || 'Não informado'}
- Dores conhecidas: ${account.contexto || account.resumo || 'Não informadas'}
- Gancho personalizado: ${account.ganchoPersonalizado || 'Não informado'}
- Cases selecionados: ${(account.cases || []).join(', ')}

HISTÓRICO ANTERIOR DA CONTA:
${recentHistory}

SITUAÇÃO DESTA TENTATIVA:
- Tentativa registrada agora: ${prevAttempt}/${maxAttempts}
- Chips rápidos selecionados: ${chips.length > 0 ? chips.join(', ') : 'Nenhum'}
- Vai para blackout (ciclo encerrado)? ${isBlackout ? 'SIM' : 'NÃO'}
- Próximo passo agendado (janela matinal 09h30 / 10h00): ${isBlackout ? 'Ciclo encerrado — E-mail de Blackout' : nextFollowUp.label}

BASE DE CONHECIMENTO MARKDOWN DO PROJETO:
${kbContext}

TEMPLATES CADASTRADOS NO PROJETO (USE COMO BASE):
- Estrutura de referência do CRM:
${crmTemplate}
- Estágio de e-mail correspondente agora: ${stageMeta.stageBadge}
- Assunto base (${stageMeta.stageBadge}): ${baseEmailSubject}
- Corpo base (${stageMeta.stageBadge}):
"""
${baseEmailBody}
"""
- Template WhatsApp base:
"""
${baseWhatsappBody}
"""
- Scripts do projeto:
${scriptsSummary}

ENTRADA COMBINADA DO VENDEDOR (CHIPS + MICROFONE / TRANSCRIÇÃO COLADA):
"""
${rawInput}
"""

REGRAS OBRIGATÓRIAS:
1. Escreva TODAS as saídas em português natural, claro e 100% SEM ABREVIAÇÕES (proibido usar "min", "att", "vc", "pq", "obs", "Dr.", "Dra.", "tel.", "cel.", "aprox.", "msg" — sempre escreva por extenso: "minutos", "atenciosamente", "você", "doutor", "doutora", "telefone", "celular", "aproximadamente", "mensagem").
2. Extraia qualquer novo contato, nome, cargo, telefone direto, ramal ou e-mail mencionado na fala/transcrição (preenchendo "novoContato", "telefoneDireto" e "emailDireto"), além de sistema atual e novas dores.
3. Campo "atualizacaoCrm" (para a Aba 3 — Atualização do CRM): gere um resumo executivo estruturado e pronto para colar no card do CRM contendo obrigatoriamente os 4 blocos limpos em linhas separadas:
   - Status da tentativa: Tentativa ${prevAttempt}/${maxAttempts} — [desfecho claro]
   - O que foi apurado: [resumo fiel e direto do que foi conversado, se falou com recepção, se não atendeu ou objeção citada]
   - Contatos e detalhes descobertos: [novos contatos, telefones diretos, e-mails, sistema ou observações; se nada novo, informe "Sem novos contatos informados"]
   - Próximo passo: [${isBlackout ? 'Ciclo encerrado após E-mail de Blackout' : `Agendado para ${nextFollowUp.label} (janela matinal 09h30 / 10h00)`}]
4. Campos "emailAssunto" e "emailCorpo" (para a Aba 4 — ${stageMeta.stageBadge}): adapte o template base de ${stageMeta.stageBadge} acima incorporando de forma natural o contexto real desta tentativa (por exemplo: se falou com a recepção, se não atendeu, ou se o decisor pediu envio de material sobre um ponto específico citado na transcrição). Se o nome do decisor não existir, ajuste a saudação para "[Nome do Lead]" sem artigos soltos.
5. Assine sempre o final de "emailCorpo" e de "whatsappCorpo" exatamente com a Assinatura Oficial abaixo, preservando rigorosamente todas as quebras de linha (\\n):
"""
${signature}
"""
6. Nos horários sugeridos de reunião no E-mail ou WhatsApp, utilize APENAS horários matinais: 09h30, 10h00 ou 10h30 (ex: ${date1} ou ${date2} às 09h30 ou 10h00).
7. Se "Vai para blackout" for NÃO, atualize "scriptJuridico" e "scriptFinanceiro" incorporando as novidades para a próxima tentativa (${nextAttempt}/${maxAttempts}).

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "resumoInteracao": "Resumo objetivo em 1 frase sem abreviações para o histórico",
  "atualizacaoCrm": "Bloco completo estruturado para colar no CRM, 100% sem abreviações",
  "novoContato": { "nome": "string ou vazio", "cargo": "string ou vazio", "perfil": "Jurídico ou Financeiro", "telefone": "string ou vazio", "email": "string ou vazio" },
  "telefoneDireto": "telefone direto mencionado na fala/transcrição ou vazio",
  "emailDireto": "e-mail direto mencionado na fala/transcrição ou vazio",
  "sistemaAtual": "sistema atualizado ou o anterior",
  "novasDores": "texto consolidado das dores sem abreviações",
  "scriptJuridico": "novo script falado completo sem abreviações para persona Jurídica",
  "scriptFinanceiro": "novo script falado completo sem abreviações para persona Financeira",
  "emailAssunto": "assunto do e-mail adaptado sem abreviações",
  "emailCorpo": "corpo do e-mail adaptado sem abreviações, encerrando exatamente com a Assinatura Oficial preservando quebras de linha",
  "whatsappCorpo": "mensagem de WhatsApp adaptada sem abreviações, encerrando exatamente com a Assinatura Oficial preservando quebras de linha"
}`;

  const { text } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: false,
    systemInstruction: getEffectivePlaybookRules(),
  });

  return parseJsonFromGeminiText(text);
}

// ==========================================================================
// Interpolation & Deterministic Fallback Generators (Zero Abbreviations)
// ==========================================================================
function isMissingDecisorName(rawName) {
  const clean = String(rawName ?? '').trim();
  if (!clean) return true;
  return /^(?:sem\s*mapeado|n[aã]o\s*mapeado|n[aã]o\s*informado|n[aã]o\s*identificado|desconhecido|decisor|lead|respons[aá]vel(?:\s+pela\s+[aá]rea(?:\s+jur[ií]dica)?)?|o\s+respons[aá]vel(?:\s+pela\s+[aá]rea(?:\s+jur[ií]dica)?)?|a\s*confirmar|n\/?a|-+|—+|null|undefined)$/i.test(
    clean
  );
}

function getInterpolationMap(account) {
  const [date1, date2] = getNextBusinessDays(2).map((d) => d.label);
  const cases = Array.isArray(account?.cases) && account.cases.length > 0
    ? account.cases
    : BENNER_CASES[account?.vertical] || ["Rede D'Or São Luiz", 'Dasa'];

  const rawVars = account?.variaveis && typeof account.variaveis === 'object' ? account.variaveis : {};
  const varDecisor = isMissingDecisorName(rawVars.decisor) ? '' : String(rawVars.decisor || '').trim();
  const accDecisor = isMissingDecisorName(account?.decisor) ? '' : String(account?.decisor || '').trim();
  const candidateDecisor = varDecisor || accDecisor;
  const hasValidDecisor = Boolean(candidateDecisor);

  let fullDecisor = '[Nome do Lead]';
  let greetingName = '[Nome do Lead]';
  if (hasValidDecisor) {
    fullDecisor = candidateDecisor
      .replace(/\bDra\.?\s+/gi, 'Doutora ')
      .replace(/\bDr\.?\s+/gi, 'Doutor ')
      .trim();
    const parts = fullDecisor.split(/\s+/);
    greetingName = /^(Doutor|Doutora)$/i.test(parts[0]) && parts.length > 1
      ? `${parts[0]} ${parts[1]}`
      : parts[0];
  }

  const saudacao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
  const hora1 = '09h30';
  const hora2 = '10h00';
  const signature = getProjectSignature();

  const empresaVal = rawVars.empresa || account?.empresa || 'Empresa';
  const verticalVal = rawVars.vertical || account?.vertical || 'Enterprise';
  const personaVal = rawVars.persona || account?.persona || 'Jurídico';
  const case1Val = rawVars.case1 || cases[0] || "Rede D'Or São Luiz";
  const case2Val = rawVars.case2 || cases[1] || cases[0] || 'Dasa';
  const dorVal =
    rawVars.dor_especifica ||
    account?.dorEspecifica ||
    account?.contexto ||
    'redução de triagem manual de iniciais e previsibilidade de provisões';
  const ganchoVal = rawVars.gancho_personalizado || account?.ganchoPersonalizado || '';

  return {
    __hasValidDecisor: hasValidDecisor,
    saudacao,
    dia1: date1,
    hora1,
    dia2: date2,
    hora2,
    nome: greetingName,
    decisor: fullDecisor,
    empresa: empresaVal,
    vertical: verticalVal,
    persona: personaVal,
    case_1: case1Val,
    case1: case1Val,
    case_2: case2Val,
    case2: case2Val,
    dor_especifica: dorVal,
    gancho_personalizado: ganchoVal,
    assinatura: signature,
    Nome: greetingName,
    Empresa: empresaVal,
    Vertical: verticalVal,
    'Case 1': case1Val,
    'Case 2': case2Val,
    Assinatura: signature,
    'Data 1': date1,
    'Data 2': date2,
    Hora: hora1,
    Decisor: fullDecisor,
    SistemaAtual: filterRealEnterpriseSystem(account?.sistemaAtual) || 'Não informado',
  };
}

function interpolateText(templateStr, account) {
  const map = getInterpolationMap(account);
  let output = String(templateStr || '');

  if (!map.__hasValidDecisor) {
    const decisorTokenLookahead = '(?=(?:\\{\\{?\\s*(?:decisor|nome)\\s*\\}?\\}|\\[(?:Decisor|Nome)\\]))';
    const singlePassRegex = new RegExp(
      `(?:(^|[.!?]\\s+|\\n)[oa]\\s+|\\b(?:(para\\s+[oa]|pra|pro)|(com\\s+[oa])|(ao|à)|(d[oa])|(n[oa])|(pel[oa]))\\s+|(\\s)o\\s+)${decisorTokenLookahead}`,
      'gi'
    );
    output = output.replace(
      singlePassRegex,
      (match, sentStart, gPara, gCom, gAo, gDe, gEm, gPor, gSpaceO) => {
        if (gPara) return 'para ';
        if (gCom) return 'com ';
        if (gAo) return 'a ';
        if (gDe) return 'de ';
        if (gEm) return 'em ';
        if (gPor) return 'por ';
        if (gSpaceO) return gSpaceO;
        return sentStart || '';
      }
    );
  }

  Object.entries(map).forEach(([key, val]) => {
    if (key.startsWith('__')) return;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'gi'), val);
    output = output.replace(new RegExp(`\\[${escaped}\\]`, 'g'), val);
    output = output.replace(new RegExp(`\\{${escaped}\\}`, 'gi'), val);
  });

  if (!map.__hasValidDecisor) {
    output = output
      .replace(/\bpara\s+[oa]\s*,/gi, 'para [Nome do Lead],')
      .replace(/\bcom\s+[oa]\s*,/gi, 'com [Nome do Lead],')
      .replace(/\bd[oa]\s*,/gi, 'de [Nome do Lead],')
      .replace(/\b(?:ao|à)\s*,/gi, 'a [Nome do Lead],')
      .replace(/\bn[oa]\s*,/gi, 'em [Nome do Lead],')
      .replace(/\bpel[oa]\s*,/gi, 'por [Nome do Lead],');
  }

  return output;
}

function buildBitrixOutput(account, nextStepText, historyLine) {
  const tpl = vfState.projectConfig.bitrixActivityTemplate || DEFAULT_PROJECT_CONFIG.bitrixActivityTemplate;
  const safeDecisor = isMissingDecisorName(account?.decisor) ? '[Nome do Lead]' : String(account.decisor).trim();
  return tpl
    .replace(/\[Decisor\]/g, safeDecisor)
    .replace(/\[Empresa\]/g, account?.empresa || 'Empresa')
    .replace(/\[ProximoPasso\]/g, nextStepText || account?.proximoPasso || 'Aguardando definição')
    .replace(/\[SistemaAtual\]/g, account?.sistemaAtual || 'A confirmar')
    .replace(/\[Historico\]/g, historyLine || (account?.historico && account.historico[0]) || 'Sem registro recente');
}

function buildFallbackMessages(account, isBlackout) {
  const attempt = Number(account?.tentativa || 1);
  const signature = getProjectSignature();
  if (isBlackout || attempt >= getProjectLimits().maxAttempts) {
    return {
      emailSubject: interpolateText(vfState.templates.email3Subject, account),
      emailBody: preserveMultilineSignature(interpolateText(vfState.templates.email3Body, account), signature, true),
      whatsappBody: preserveMultilineSignature(interpolateText(vfState.templates.whatsappPontual, account), signature, true),
    };
  }
  const subjKey = attempt === 2 ? 'email2Subject' : 'email1Subject';
  const bodyKey = attempt === 2 ? 'email2Body' : 'email1Body';
  return {
    emailSubject: interpolateText(vfState.templates[subjKey], account),
    emailBody: preserveMultilineSignature(interpolateText(vfState.templates[bodyKey], account), signature, true),
    whatsappBody: preserveMultilineSignature(interpolateText(vfState.templates.whatsappPontual, account), signature, true),
  };
}

// ==========================================================================
// Stage Machine & UI Rendering
// ==========================================================================
function setStage(stage) {
  vfState.stage = stage;
  const stageProjects = document.getElementById('vf-stage-projects');
  const topbar = document.getElementById('vf-workspace-topbar');
  const stageIntake = document.getElementById('vf-stage-intake');
  const stageCockpit = document.getElementById('vf-stage-cockpit');

  stageProjects?.classList.toggle('hidden', stage !== 'projects');
  topbar?.classList.toggle('hidden', stage === 'projects');
  stageIntake?.classList.toggle('hidden', stage !== 'intake');
  stageCockpit?.classList.toggle('hidden', stage !== 'cockpit');

  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshIcons();
}

function renderProjectsSelectorGrid() {
  const grid = document.getElementById('vf-projects-grid');
  if (!grid) return;
  const admin = isAdminRoot();
  grid.innerHTML = '';

  vfState.projects.forEach((project) => {
    const dailyTarget = Number(project.dailyTarget ?? 25);
    const newTarget = Number(project.newTarget ?? 7);
    const followupTarget = Math.max(1, dailyTarget - newTarget);
    const maxAttempts = Number(project.maxAttempts ?? 3);

    const card = document.createElement('article');
    card.className =
      'glass-card rounded-2xl p-7 flex flex-col justify-between min-h-[250px] transition-all duration-200 hover:border-blue-500/45';
    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between gap-3 mb-5">
          <div class="w-11 h-11 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <i data-lucide="radar" class="w-5 h-5"></i>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs font-mono font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-400/20 px-2.5 py-1 rounded-md whitespace-nowrap">
              Meta: ${dailyTarget}/dia
            </span>
            ${
              admin
                ? `<button type="button" data-config-project="${escapeHtml(project.id)}" title="Configurar Projeto" aria-label="Configurar Projeto ${escapeHtml(project.name)}" class="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-sky-400/20 text-slate-300 hover:text-cyan-300 transition-colors">
                    <i data-lucide="settings" class="w-4 h-4"></i>
                  </button>`
                : ''
            }
          </div>
        </div>

        <h2 class="font-display font-bold text-xl tracking-[-0.02em] text-[#F8FAFC]">
          ${escapeHtml(project.name)}
        </h2>
        <p class="mt-2 text-xs sm:text-sm leading-relaxed text-[#94A3B8] line-clamp-2">
          ${escapeHtml(project.description || 'Funil comercial estruturado no Vitally Flow.')}
        </p>
      </div>

      <div class="mt-7 pt-4 border-t border-sky-400/10 flex items-center justify-between gap-3">
        <span class="text-[11px] text-slate-400">
          ${newTarget} novas · ${followupTarget} follow-ups · ${maxAttempts} tent.
        </span>
        <button
          type="button"
          data-open-project="${escapeHtml(project.id)}"
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition-all whitespace-nowrap"
        >
          <span>Abrir Projeto</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    card.querySelector('[data-open-project]')?.addEventListener('click', () => {
      openProjectIntoIntake(project);
    });

    card.querySelector('[data-config-project]')?.addEventListener('click', async () => {
      await selectProject(project, null);
      openProjectConfigModal();
    });

    grid.appendChild(card);
  });

  if (admin) {
    const newCard = document.createElement('button');
    newCard.type = 'button';
    newCard.id = 'vf-open-new-project-card';
    newCard.className =
      'group text-left rounded-2xl p-7 flex flex-col items-center justify-center min-h-[250px] border border-dashed border-sky-400/25 bg-[#0F172A]/30 hover:bg-[#0F172A]/60 hover:border-blue-400/50 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
    newCard.innerHTML = `
      <div class="w-11 h-11 rounded-xl bg-slate-800/80 border border-sky-400/20 flex items-center justify-center text-slate-400 group-hover:text-blue-400 group-hover:border-blue-400/40 transition-colors mb-4">
        <i data-lucide="plus" class="w-5 h-5"></i>
      </div>
      <span class="font-display font-semibold text-base text-slate-200 group-hover:text-white transition-colors">
        + Novo Projeto / Funil
      </span>
      <span class="mt-1.5 text-xs text-slate-400 text-center max-w-xs">
        Crie uma nova operação comercial em vf_projects com base de conhecimento própria.
      </span>
    `;
    newCard.addEventListener('click', () => {
      document.getElementById('new-project-modal')?.classList.remove('hidden');
      document.getElementById('vf-new-project-name')?.focus();
      refreshIcons();
    });
    grid.appendChild(newCard);
  }

  refreshIcons();
}

function renderTopbarControls() {
  const nameEl = document.getElementById('vf-active-project-name');
  const cfgBtn = document.getElementById('vf-open-project-config-btn');

  if (nameEl) {
    nameEl.textContent = vfState.activeProject?.name || 'Benner Jurídico';
  }
  cfgBtn?.classList.toggle('hidden', !isAdminRoot());
}

function renderScoreboard() {
  const { dailyTarget, newTarget, followupTarget } = getProjectLimits();
  const novas = Number(vfState.dailyStats.novas) || 0;
  const followups = Number(vfState.dailyStats.followups) || 0;
  const total = novas + followups;

  const totalEl = document.getElementById('vf-score-total');
  const novasEl = document.getElementById('vf-score-novas');
  const followEl = document.getElementById('vf-score-followups');

  if (totalEl) totalEl.textContent = `Meta: ${total}/${dailyTarget}`;
  if (novasEl) novasEl.textContent = `Novas: ${novas}/${newTarget}`;
  if (followEl) followEl.textContent = `Follow-ups: ${followups}/${followupTarget}`;
}

function expandCommonAbbreviations(rawText) {
  let text = String(rawText || '');
  if (!text) return '';
  text = text
    .replace(/\bDra\.\s*/g, 'Doutora ')
    .replace(/\bDr\.\s*/g, 'Doutor ')
    .replace(/\bSr\.\s*/g, 'Senhor ')
    .replace(/\bSra\.\s*/g, 'Senhora ')
    .replace(/(\d+)\s*min\b\.?/gi, '$1 minutos')
    .replace(/(\d+)\s*hrs?\b\.?/gi, '$1 horas')
    .replace(/\bvcs\b/gi, 'vocês')
    .replace(/\bvc\b/gi, 'você')
    .replace(/\bpq\b/gi, 'porque')
    .replace(/\bobs\b\.?:/gi, 'observação:')
    .replace(/\bobs\b\.?/gi, 'observação')
    .replace(/\batt\b\.?/gi, 'atenciosamente')
    .replace(/\baprox\.\s*/gi, 'aproximadamente ')
    .replace(/\btel\.\s*/gi, 'telefone ')
    .replace(/\bcel\.\s*/gi, 'celular ')
    .replace(/\bmsg\b/gi, 'mensagem');
  return text;
}

function getProjectScriptsList() {
  return Array.isArray(vfState.scripts) ? vfState.scripts : [];
}

function resolveActiveProjectScript(account = null) {
  const list = getProjectScriptsList();
  if (!list.length) return null;

  if (vfState.activeScriptId) {
    const byId = list.find((s) => s.id === vfState.activeScriptId);
    if (byId) return byId;
  }

  const desiredName = String(vfState.activePersona || account?.persona || '').trim().toLowerCase();
  if (desiredName) {
    const exact = list.find((s) => String(s.name || '').trim().toLowerCase() === desiredName);
    if (exact) return exact;
    const partial = list.find((s) => String(s.name || '').trim().toLowerCase().includes(desiredName));
    if (partial) return partial;
  }

  return list[0];
}

function isTransitionOnlyDirective(text) {
  const clean = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/^[\[\(]\s*|\s*[\]\)]$/g, '')
    .replace(/[.\-!]+$/g, '')
    .trim();
  if (!clean) return true;
  if (clean.length > 90) return false;
  return (
    /^(?:pode\s+)?(?:avan[çc](?:ar|e)|ir|v[aá]|segu(?:ir|e)|pass(?:ar|e)|pul(?:ar|e)|pr[oó]ximo)\s+(?:direto\s+)?(?:para|ao|pro|a)\s+(?:o\s+|a\s+)?(?:pr[oó]xim[oa]\s+)?(?:passo|etapa|fase|\d)/i.test(
      clean
    ) ||
    /^(?:passo|etapa)\s*\d+$/i.test(clean) ||
    /^(?:agradecer\s+e\s+)?(?:encerrar|finalizar)(?:\s+(?:liga[çc][aã]o|chamada|contato|roteiro|abordagem))?$/i.test(clean)
  );
}

function extractTargetStepNumber(text) {
  const m = String(text || '').match(/(?:passo|etapa)\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

function stripInstructionLabelsFromSpeech(rawText) {
  let text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const lineInstructionPrefix =
    /^(?:[-*•>→]\s*)?(?:\*\*|__)?(?:(?:se|caso|quando)\s+(?:ele\s+|ela\s+|o\s+lead\s+|o\s+decisor\s+|o\s+cliente\s+|a\s+pessoa\s+)?(?:respondeu|responder|disser|dizer|falar|falar\s+que|aceitar|recusar|negar)?\s*(?:sim|n[aã]o|positivo|negativo)|em\s+caso\s+de\s+(?:sim|n[aã]o)|resposta\s+(?:sim|n[aã]o|positiva|negativa)|(?:fala\s+principal|texto\s+para\s+ler|roteiro|script|vendedor|sdr|contorno(?:\s+de\s+obje[cç][aã]o)?|obje[cç][aã]o))(?:\*\*|__)?\s*(?:[:\-–—]|->|=>|,)\s*(?:(?:diga|fale|responda|leia)\s*[:\-–—,]?\s*)?/i;

  const cleanedLines = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== '') {
        cleanedLines.push('');
      }
      continue;
    }

    // Remove repeated instruction prefixes at start of line
    line = line.replace(lineInstructionPrefix, '').trim();
    line = line.replace(/^(?:diga|fale|responda|leia\s+em\s+voz\s+alta)\s*[:\-–—]\s*/i, '').trim();

    if (!line || isTransitionOnlyDirective(line)) {
      continue;
    }

    // Remove trailing inline instruction directives like "... (Avance direto para o Passo 2)"
    // or "... Se respondeu SIM: Avance direto para o Passo 2"
    line = line
      .replace(/[\(\[]\s*(?:avan[çc](?:ar|e)|v[aá]|ir|segu(?:ir|e)|pular?)\s+(?:direto\s+)?(?:para|ao)\s+(?:o\s+|a\s+)?(?:passo|etapa)\s*\d+[^\)\]]*[\)\]]/gi, '')
      .replace(/\s+(?:se|caso|quando)\s+(?:ele\s+|ela\s+|o\s+lead\s+|o\s+decisor\s+)?(?:respondeu|responder|disser|falar)\s+(?:sim|n[aã]o)\s*(?:[:\-–—,.]|->|=>)\s*(?:avan[çc](?:ar|e)|v[aá]|ir|segu(?:ir|e)|pular?)[^\n]*$/i, '')
      .replace(/(?:[.\-–—;]|\s)\s*(?:avan[çc](?:ar|e)|v[aá]|ir|segu(?:ir|e)|pular?)\s+(?:direto\s+)?(?:para|ao)\s+(?:o\s+|a\s+)?(?:passo|etapa)\s*\d+[^.!?\n]*\.?$/i, '')
      .trim();

    if (!line || isTransitionOnlyDirective(line)) {
      continue;
    }

    // Unwrap matching outer quotation marks when only the spoken phrase was quoted
    if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith('“') && line.endsWith('”'))) {
      line = line.slice(1, -1).trim();
    }

    if (line) cleanedLines.push(line);
  }

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseStepBranches(blockLines) {
  const mainLines = [];
  const yesLines = [];
  const noLines = [];
  let mode = 'main';

  const yesBranchRegex =
    /^(?:[-*•>→]\s*)?(?:\*\*|__)?(?:(?:se|caso|quando)\s+(?:ele\s+|ela\s+|o\s+lead\s+|o\s+decisor\s+|o\s+cliente\s+|a\s+pessoa\s+)?(?:respondeu|responder|disser|dizer|falar|falar\s+que|aceitar)\s+(?:sim|positivo)|caso\s+responda\s+sim|se\s+sim|respondeu\s+sim|em\s+caso\s+de\s+sim|resposta\s+(?:sim|positiva)|\[?\s*sim\s*\]?)\s*(?:\*\*|__)?\s*(?:[:\-–—,.]|->|=>)\s*(.*)$/i;
  const noBranchRegex =
    /^(?:[-*•>→]\s*)?(?:\*\*|__)?(?:(?:se|caso|quando)\s+(?:ele\s+|ela\s+|o\s+lead\s+|o\s+decisor\s+|o\s+cliente\s+|a\s+pessoa\s+)?(?:respondeu|responder|disser|dizer|falar|falar\s+que|recusar|negar)\s+(?:n[aã]o|negativo)|caso\s+responda\s+n[aã]o|se\s+n[aã]o|respondeu\s+n[aã]o|em\s+caso\s+de\s+n[aã]o|resposta\s+(?:n[aã]o|negativa)|\[?\s*n[aã]o\s*\]?|contorno(?:\s+de\s+obje[cç][aã]o)?|obje[cç][aã]o)\s*(?:\*\*|__)?\s*(?:[:\-–—,.]|->|=>)\s*(.*)$/i;

  for (const rawLine of blockLines) {
    const trimmed = rawLine.trim();
    const yesMatch = trimmed.match(yesBranchRegex);
    if (yesMatch) {
      mode = 'yes';
      if (yesMatch[1] && yesMatch[1].trim()) yesLines.push(yesMatch[1].trim());
      continue;
    }

    const noMatch = trimmed.match(noBranchRegex);
    if (noMatch) {
      mode = 'no';
      if (noMatch[1] && noMatch[1].trim()) noLines.push(noMatch[1].trim());
      continue;
    }

    if (mode === 'yes') yesLines.push(rawLine);
    else if (mode === 'no') noLines.push(rawLine);
    else mainLines.push(rawLine);
  }

  return {
    mainSpeech: stripInstructionLabelsFromSpeech(mainLines.join('\n').trim()),
    yesRaw: yesLines.join('\n').trim(),
    yesSpeech: stripInstructionLabelsFromSpeech(yesLines.join('\n').trim()),
    noRaw: noLines.join('\n').trim(),
    noSpeech: stripInstructionLabelsFromSpeech(noLines.join('\n').trim()),
  };
}

function parseScriptContentToSteps(rawContent, scriptName = 'Abordagem') {
  const normalized = String(rawContent || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const stepHeaderRegex =
    /^(?:#{1,4}\s*)?(?:\*\*|__)?(?:(passo|etapa)\s*(\d{1,2})\s*(?:(?:\*\*|__)?\s*[—\-–:.\)]+\s*(?:\*\*|__)?\s*(.*?))?|(\d{1,2})\s*[\.\)\-–:]+\s+(?:\*\*|__)?([^\n]{2,}))(?:\*\*|__)?\s*$/i;

  const sections = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(stepHeaderRegex);
    if (match) {
      const stepNum = Number(match[2] || match[4] || sections.length + 1);
      const restText = String(match[3] || match[5] || '')
        .replace(/(?:\*\*|__)$/g, '')
        .replace(/:\s*$/, '')
        .trim();

      const looksLikeInlineSentence =
        restText.length > 52 ||
        /[?!]$/.test(restText) ||
        /\{\{?\w+\}?\}/.test(restText);

      if (current && (current.lines.length > 0 || current.rawTitle)) {
        sections.push(current);
      }

      const cleanTitle = !looksLikeInlineSentence && restText
        ? restText
        : `Etapa ${stepNum}`;
      current = {
        stepNum,
        rawTitle: cleanTitle,
        lines: looksLikeInlineSentence && restText ? [restText] : [],
      };
      continue;
    }

    if (!current) {
      if (!trimmed) continue;
      current = {
        stepNum: 1,
        rawTitle: '',
        lines: [line],
      };
    } else {
      current.lines.push(line);
    }
  }

  if (current && (current.lines.length > 0 || current.rawTitle)) {
    sections.push(current);
  }

  const nonEmptySections = sections.filter((s) => s.lines.some((l) => l.trim().length > 0) || s.rawTitle);

  // Case 1: Multiple structured steps parsed
  if (nonEmptySections.length >= 2) {
    return nonEmptySections.map((sec, idx) => {
      const parsed = parseStepBranches(sec.lines);
      const stepNumber = idx + 1;
      const baseTitle = sec.rawTitle || `Etapa ${stepNumber}`;
      const shortLabel = `${stepNumber}. ${baseTitle.length > 16 ? `${baseTitle.slice(0, 15)}…` : baseTitle}`;
      return {
        step: stepNumber,
        short: shortLabel,
        title: /^(passo|etapa)\s*\d+/i.test(baseTitle) ? baseTitle : `Passo ${stepNumber} — ${baseTitle}`,
        mainSpeech: parsed.mainSpeech || stripInstructionLabelsFromSpeech(sec.lines.join('\n').trim()),
        yesRaw: parsed.yesRaw,
        yesSpeech: parsed.yesSpeech,
        noRaw: parsed.noRaw,
        noSpeech: parsed.noSpeech,
      };
    });
  }

  // Case 2: Unmarked text -> check multi-paragraph blocks
  const paragraphs = normalized.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= 6) {
    return paragraphs.map((para, idx) => {
      const parsed = parseStepBranches(para.split('\n'));
      const stepNumber = idx + 1;
      const autoName =
        idx === 0
          ? 'Abertura'
          : idx === paragraphs.length - 1
            ? 'Fechamento'
            : `Etapa ${stepNumber}`;
      return {
        step: stepNumber,
        short: `${stepNumber}. ${autoName}`,
        title: `Passo ${stepNumber} — ${autoName}`,
        mainSpeech: parsed.mainSpeech || stripInstructionLabelsFromSpeech(para),
        yesRaw: parsed.yesRaw,
        yesSpeech: parsed.yesSpeech,
        noRaw: parsed.noRaw,
        noSpeech: parsed.noSpeech,
      };
    });
  }

  // Case 3: Single-block script -> render strictly the user's registered text with no invented steps
  const singleParsed = parseStepBranches(normalized.split('\n'));
  const singleText = singleParsed.mainSpeech || stripInstructionLabelsFromSpeech(normalized);
  return [
    {
      step: 1,
      short: `1. ${scriptName.length > 14 ? `${scriptName.slice(0, 13)}…` : scriptName}`,
      title: scriptName,
      mainSpeech: singleText,
      yesRaw: singleParsed.yesRaw,
      yesSpeech: singleParsed.yesSpeech,
      noRaw: singleParsed.noRaw,
      noSpeech: singleParsed.noSpeech,
    },
  ];
}

function convertScriptToDecisionTree(rawContent, scriptName = 'Script') {
  const normalized = String(rawContent || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const unfenced = normalized
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Support structured JSON directly if pasted/provided or returned by Gemini (including fenced JSON)
  if (unfenced.startsWith('{') || unfenced.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(unfenced);
      const arr = Array.isArray(parsedJson)
        ? parsedJson
        : Array.isArray(parsedJson?.passos)
          ? parsedJson.passos
          : Array.isArray(parsedJson?.steps)
            ? parsedJson.steps
            : null;
      if (arr && arr.length > 0) {
        return arr.map((item, idx) => {
          const stepNumber = Number(item.step || item.passo || idx + 1);
          const title = String(item.title || item.titulo || `Passo ${stepNumber}`).trim();
          const shortTitle = title.replace(/^(?:passo|etapa)\s*\d+\s*[—\-–:]?\s*/i, '').trim() || `Etapa ${stepNumber}`;
          const falaPrincipal = stripInstructionLabelsFromSpeech(item.fala_principal || item.fala || item.speech || '');
          const simFala = stripInstructionLabelsFromSpeech(item.acao_sim?.fala || item.sim_fala || '');
          const naoFala = stripInstructionLabelsFromSpeech(item.acao_nao?.fala || item.nao_fala || item.contorno || '');
          const nextDefault = idx + 1 < arr.length ? idx + 2 : null;
          const naoNext = Number(item.acao_nao?.proximo_passo || 0) || null;
          return {
            step: stepNumber,
            short: `${stepNumber}. ${shortTitle.length > 16 ? `${shortTitle.slice(0, 15)}…` : shortTitle}`,
            title,
            fala_principal: falaPrincipal,
            acao_sim: {
              tipo: simFala ? 'falar' : nextDefault ? 'avancar' : 'concluir',
              proximo_passo: Number(item.acao_sim?.proximo_passo || nextDefault || 0) || nextDefault,
              fala: simFala,
            },
            acao_nao: {
              tipo: naoFala ? 'falar' : item.acao_nao?.tipo === 'avancar' && naoNext ? 'avancar' : 'encerrar',
              proximo_passo: naoNext,
              fala: naoFala,
            },
          };
        });
      }
    } catch {
      // Fallback to natural text parser
    }
  }

  const steps = parseScriptContentToSteps(normalized, scriptName);
  const total = steps.length;

  return steps.map((step, idx) => {
    const nextDefault = idx + 1 < total ? idx + 2 : null;
    const explicitYesTarget = extractTargetStepNumber(step.yesRaw);
    const explicitNoTarget = extractTargetStepNumber(step.noRaw);
    const yesTarget = explicitYesTarget && explicitYesTarget >= 1 && explicitYesTarget <= total ? explicitYesTarget : nextDefault;
    const noTarget = explicitNoTarget && explicitNoTarget >= 1 && explicitNoTarget <= total ? explicitNoTarget : null;

    const cleanMain = stripInstructionLabelsFromSpeech(step.mainSpeech);
    const cleanYes = stripInstructionLabelsFromSpeech(step.yesSpeech);
    const cleanNo = stripInstructionLabelsFromSpeech(step.noSpeech);

    return {
      step: step.step,
      short: step.short,
      title: step.title,
      fala_principal: cleanMain,
      acao_sim: {
        tipo: cleanYes ? 'falar' : yesTarget ? 'avancar' : 'concluir',
        proximo_passo: yesTarget,
        fala: cleanYes,
      },
      acao_nao: {
        tipo: cleanNo ? 'falar' : noTarget ? 'avancar' : 'encerrar',
        proximo_passo: cleanNo ? nextDefault : noTarget,
        fala: cleanNo,
      },
    };
  });
}

function serializeDecisionTreeToText(decisionTree) {
  if (!Array.isArray(decisionTree) || decisionTree.length === 0) return '';
  return decisionTree
    .map((node, idx) => {
      const lines = [];
      const header = /^(passo|etapa)\s*\d+/i.test(node.title || '')
        ? node.title
        : `Passo ${node.step || idx + 1}: ${node.title || `Etapa ${idx + 1}`}`;
      lines.push(header);
      if (node.fala_principal) lines.push(node.fala_principal);

      if (node.acao_sim?.tipo === 'falar' && node.acao_sim.fala) {
        lines.push(`Se respondeu SIM: ${node.acao_sim.fala}`);
      } else if (node.acao_sim?.proximo_passo) {
        lines.push(`Se respondeu SIM: Avançar para o Passo ${node.acao_sim.proximo_passo}`);
      }

      if (node.acao_nao?.tipo === 'falar' && node.acao_nao.fala) {
        lines.push(`Se respondeu NÃO: ${node.acao_nao.fala}`);
      } else if (node.acao_nao?.tipo === 'avancar' && node.acao_nao.proximo_passo) {
        lines.push(`Se respondeu NÃO: Avançar para o Passo ${node.acao_nao.proximo_passo}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

function buildDynamicScriptTree(scriptObj) {
  if (!scriptObj) {
    return {
      scriptObj: null,
      scriptName: '',
      steps: [],
      nodes: {},
      firstNodeId: null,
    };
  }

  const scriptName = scriptObj.name || 'Script';
  const rawContent = String(scriptObj.content || '').trim();
  const rawTree = rawContent
    ? convertScriptToDecisionTree(rawContent, scriptName)
    : Array.isArray(scriptObj.decisionTree)
      ? scriptObj.decisionTree
      : [];

  const steps = rawTree.filter((s) => s && (s.fala_principal || s.acao_sim?.fala || s.acao_nao?.fala));
  if (steps.length === 0) {
    return {
      scriptObj,
      scriptName,
      steps: [],
      nodes: {},
      firstNodeId: null,
    };
  }

  const total = steps.length;
  const nodes = {};

  const resolveStepMainId = (targetStepNum, fallbackIdx) => {
    if (targetStepNum && targetStepNum >= 1 && targetStepNum <= total) {
      return `s${targetStepNum - 1}_main`;
    }
    return fallbackIdx < total ? `s${fallbackIdx}_main` : 's_won';
  };

  steps.forEach((step, idx) => {
    const nextMainId = resolveStepMainId(step.acao_sim?.proximo_passo, idx + 1);
    const nextNoId = step.acao_nao?.proximo_passo ? resolveStepMainId(step.acao_nao.proximo_passo, idx + 1) : `s${idx}_end`;
    const nextStepNum = step.acao_sim?.proximo_passo || (idx + 1 < total ? idx + 2 : null);
    const nextStepLabel = nextStepNum ? `Passo ${nextStepNum}` : 'Conclusão';
    const hasSpokenYes = step.acao_sim?.tipo === 'falar' && Boolean(step.acao_sim?.fala);
    const hasSpokenNo = step.acao_nao?.tipo === 'falar' && Boolean(step.acao_nao?.fala);
    const mainSpeechClean = stripInstructionLabelsFromSpeech(step.fala_principal || '');
    const yesSpeechClean = stripInstructionLabelsFromSpeech(step.acao_sim?.fala || '');
    const noSpeechClean = stripInstructionLabelsFromSpeech(step.acao_nao?.fala || '');

    nodes[`s${idx}_main`] = {
      step: step.step || idx + 1,
      branchLabel: 'Fluxo Principal',
      branchTone: 'main',
      speech: mainSpeechClean,
      yesHint: hasSpokenYes
        ? 'Exibir resposta positiva'
        : nextStepNum
          ? `Avançar para ${nextStepLabel}`
          : 'Concluir roteiro',
      noHint: hasSpokenNo
        ? 'Exibir contorno'
        : step.acao_nao?.tipo === 'avancar' && step.acao_nao?.proximo_passo
          ? `Ir para Passo ${step.acao_nao.proximo_passo}`
          : 'Registrar negativa',
      yesNext: hasSpokenYes ? `s${idx}_yes` : nextMainId,
      noNext: hasSpokenNo ? `s${idx}_no` : nextNoId,
      yesLog: `Respondeu SIM no Passo ${step.step || idx + 1}`,
      noLog: hasSpokenNo
        ? `Respondeu NÃO no Passo ${step.step || idx + 1} (contorno aplicado)`
        : `Respondeu NÃO no Passo ${step.step || idx + 1}`,
    };

    if (hasSpokenYes) {
      nodes[`s${idx}_yes`] = {
        step: step.step || idx + 1,
        branchLabel: 'Resposta SIM',
        branchTone: 'won',
        speech: yesSpeechClean,
        yesHint: nextStepNum ? `Avançar para ${nextStepLabel}` : 'Concluir roteiro',
        noHint: hasSpokenNo ? 'Exibir contorno' : 'Registrar negativa',
        yesNext: nextMainId,
        noNext: hasSpokenNo ? `s${idx}_no` : nextNoId,
        yesLog: `Avançou após confirmação no Passo ${step.step || idx + 1}`,
        noLog: `Negativa registrada no Passo ${step.step || idx + 1}`,
      };
    }

    if (hasSpokenNo) {
      nodes[`s${idx}_no`] = {
        step: step.step || idx + 1,
        branchLabel: 'Contorno',
        branchTone: 'contorno',
        speech: noSpeechClean,
        yesHint: idx + 1 < total ? `Superou objeção → Passo ${idx + 2}` : 'Concluir roteiro',
        noHint: 'Registrar negativa',
        yesNext: idx + 1 < total ? `s${idx + 1}_main` : 's_won',
        noNext: `s${idx}_end`,
        yesLog: `Superou objeção no Passo ${step.step || idx + 1}`,
        noLog: `Manteve negativa no Passo ${step.step || idx + 1}`,
      };
    }

    nodes[`s${idx}_end`] = {
      step: step.step || idx + 1,
      branchLabel: `Desfecho — Passo ${step.step || idx + 1}`,
      branchTone: 'end',
      isTerminal: true,
      speech:
        'Negativa registrada para {{empresa}}. Prossiga para o registro da tentativa.',
    };
  });

  nodes.s_won = {
    step: total,
    branchLabel: 'Roteiro Concluído',
    branchTone: 'won',
    isTerminal: true,
    speech:
      'Roteiro concluído para {{empresa}}. Prossiga para o registro do desfecho.',
  };

  return {
    scriptObj,
    scriptName,
    steps,
    nodes,
    firstNodeId: 's0_main',
  };
}

function getActiveScriptTree(account = null) {
  const activeScript = resolveActiveProjectScript(account);
  if (activeScript) {
    vfState.activeScriptId = activeScript.id;
    vfState.activePersona = activeScript.name || vfState.activePersona;
  } else {
    vfState.activeScriptId = null;
  }
  return buildDynamicScriptTree(activeScript);
}

function switchCockpitTab(tabName) {
  const validTabs = ['script', 'registro', 'bitrix', 'email'];
  const nextTab = validTabs.includes(tabName) ? tabName : 'script';
  vfState.activeCockpitTab = nextTab;

  document.querySelectorAll('.vf-cockpit-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-cockpit-tab') === nextTab);
  });
  document.querySelectorAll('.vf-cockpit-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });
  document.getElementById(`vf-cockpit-panel-${nextTab}`)?.classList.remove('hidden');

  if (nextTab === 'registro') {
    setTimeout(() => document.getElementById('vf-interaction-input')?.focus(), 40);
  }
  refreshIcons();
}

function resetScriptFlow(shouldRender = true) {
  vfState.scriptFlow = {
    nodeId: 's0_main',
    history: [],
    pathNotes: [],
  };
  if (shouldRender) {
    renderScriptInteractive(getActiveAccount());
  }
}

function selectCockpitScript(scriptItem) {
  if (!scriptItem) return;
  vfState.activeScriptId = scriptItem.id;
  vfState.activePersona = scriptItem.name || 'Jurídico';
  const acc = getActiveAccount();
  if (acc) {
    acc.persona = vfState.activePersona;
    saveAccountsLocal();
    syncLeadToSupabase(acc);
  }
  resetScriptFlow(true);
}

function advanceScriptDecision(choice) {
  const account = getActiveAccount();
  const tree = getActiveScriptTree(account);
  if (!tree.steps.length || !tree.firstNodeId) return;
  const current = tree.nodes[vfState.scriptFlow.nodeId] || tree.nodes[tree.firstNodeId];
  if (!current || current.isTerminal) return;

  const nextId = choice === 'yes' ? current.yesNext : current.noNext;
  const logRaw = choice === 'yes' ? current.yesLog : current.noLog;
  if (!nextId || !tree.nodes[nextId]) return;

  const interpolatedLog = account ? expandCommonAbbreviations(interpolateText(logRaw, account)) : logRaw;
  vfState.scriptFlow.history.push({
    nodeId: vfState.scriptFlow.nodeId,
    pathNotes: [...vfState.scriptFlow.pathNotes],
  });
  vfState.scriptFlow.nodeId = nextId;
  if (interpolatedLog) {
    vfState.scriptFlow.pathNotes.push(interpolatedLog);
  }
  renderScriptInteractive(account);
}

function stepBackScriptDecision() {
  if (!vfState.scriptFlow.history.length) return;
  const prev = vfState.scriptFlow.history.pop();
  vfState.scriptFlow.nodeId = prev.nodeId;
  vfState.scriptFlow.pathNotes = prev.pathNotes;
  renderScriptInteractive(getActiveAccount());
}

function buildScriptPathSummary(account) {
  const tree = getActiveScriptTree(account);
  if (!tree.steps.length || !tree.firstNodeId) {
    return 'Registro de abordagem comercial.';
  }
  const current = tree.nodes[vfState.scriptFlow.nodeId] || tree.nodes[tree.firstNodeId];
  const stepMeta = tree.steps.find((s) => s.step === current.step) || tree.steps[0];
  const notes = vfState.scriptFlow.pathNotes;
  const personaLabel = tree.scriptName || vfState.activePersona || 'Script';

  if (notes.length === 0) {
    return `Abordagem via Script (${personaLabel}) — Iniciou em ${stepMeta.title}.`;
  }
  return `Script (${personaLabel}): ${notes.join(' → ')} (avançou até Passo ${current.step}/${tree.steps.length}).`;
}

function finishScriptFlowToRegistro() {
  const account = getActiveAccount();
  const summary = buildScriptPathSummary(account);
  const input = document.getElementById('vf-interaction-input');
  if (input) {
    const existing = input.value.trim();
    if (!existing) {
      input.value = summary;
    } else if (!existing.includes(summary)) {
      input.value = `${summary}\n${existing}`;
    }
  }
  switchCockpitTab('registro');
}

function renderScriptPersonasBar(activeScript) {
  const bar = document.getElementById('vf-script-personas-bar');
  if (!bar) return;
  const scripts = getProjectScriptsList();
  bar.innerHTML = '';

  scripts.forEach((scriptItem) => {
    const isActive = activeScript ? scriptItem.id === activeScript.id : false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-script-id', scriptItem.id);
    btn.className = `vf-persona-btn ${isActive ? 'active' : ''} px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap`;
    btn.textContent = scriptItem.name || 'Script';
    btn.addEventListener('click', () => selectCockpitScript(scriptItem));
    bar.appendChild(btn);
  });
}

function renderScriptInteractive(account) {
  const scripts = getProjectScriptsList();
  const emptyStateEl = document.getElementById('vf-script-empty-state');
  const activeWrapEl = document.getElementById('vf-script-active-wrap');
  const stepperEl = document.getElementById('vf-script-stepper');
  const stepTitleEl = document.getElementById('vf-script-step-title');
  const branchBadgeEl = document.getElementById('vf-script-branch-badge');
  const speechEl = document.getElementById('vf-script-speech');
  const trailWrap = document.getElementById('vf-script-trail-wrap');
  const trailEl = document.getElementById('vf-script-trail');
  const decisionWrap = document.getElementById('vf-script-decision-buttons');
  const yesBtn = document.getElementById('vf-script-yes-btn');
  const noBtn = document.getElementById('vf-script-no-btn');
  const yesHintEl = document.getElementById('vf-script-yes-hint');
  const noHintEl = document.getElementById('vf-script-no-hint');
  const backBtn = document.getElementById('vf-script-back-btn');
  const personasBar = document.getElementById('vf-script-personas-bar');

  if (!scripts || scripts.length === 0) {
    vfState.activeScriptId = null;
    emptyStateEl?.classList.remove('hidden');
    activeWrapEl?.classList.add('hidden');
    if (personasBar) personasBar.innerHTML = '';
    if (stepperEl) stepperEl.innerHTML = '';
    if (stepTitleEl) stepTitleEl.textContent = '—';
    if (speechEl) speechEl.textContent = '';
    if (trailEl) trailEl.textContent = '';
    trailWrap?.classList.add('hidden');
    refreshIcons();
    return;
  }

  emptyStateEl?.classList.add('hidden');
  activeWrapEl?.classList.remove('hidden');

  const tree = getActiveScriptTree(account);
  renderScriptPersonasBar(tree.scriptObj);

  if (!tree.steps.length || !tree.firstNodeId) {
    if (stepperEl) stepperEl.innerHTML = '';
    if (stepTitleEl) stepTitleEl.textContent = tree.scriptName || 'Script';
    if (branchBadgeEl) {
      branchBadgeEl.textContent = 'Sem texto cadastrado';
      branchBadgeEl.className =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border bg-slate-700/40 text-slate-300 border-slate-500/35 whitespace-nowrap';
    }
    if (speechEl) {
      speechEl.textContent =
        'Este roteiro ainda não possui texto cadastrado. Adicione o conteúdo em Configuração do Projeto > Script Template.';
    }
    trailWrap?.classList.add('hidden');
    decisionWrap?.classList.add('hidden');
    if (backBtn) backBtn.disabled = true;
    refreshIcons();
    return;
  }

  const node = tree.nodes[vfState.scriptFlow.nodeId] || tree.nodes[tree.firstNodeId];
  if (!tree.nodes[vfState.scriptFlow.nodeId]) {
    vfState.scriptFlow.nodeId = tree.firstNodeId;
  }
  const stepMeta = tree.steps.find((s) => s.step === node.step) || tree.steps[0];

  if (stepperEl) {
    stepperEl.style.gridTemplateColumns = `repeat(${Math.max(1, tree.steps.length)}, minmax(0, 1fr))`;
    stepperEl.innerHTML = tree.steps.map((s) => {
      const isCurrent = s.step === node.step;
      const isDone = s.step < node.step;
      const cls = isCurrent
        ? 'bg-blue-600/25 border-blue-400/60 text-white font-semibold'
        : isDone
          ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300 font-medium'
          : 'bg-[#070B14]/60 border-sky-400/10 text-slate-500';
      return `<div class="px-2 py-1.5 rounded-lg border text-[10px] sm:text-[11px] text-center truncate ${cls}" title="${escapeHtml(s.title)}">${escapeHtml(s.short)}</div>`;
    }).join('');
  }

  if (stepTitleEl) stepTitleEl.textContent = stepMeta.title;

  if (branchBadgeEl) {
    branchBadgeEl.textContent = node.branchLabel || 'Fluxo Principal';
    if (node.branchTone === 'contorno') {
      branchBadgeEl.className =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border bg-amber-500/15 text-amber-200 border-amber-400/35 whitespace-nowrap';
    } else if (node.branchTone === 'won') {
      branchBadgeEl.className =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border bg-emerald-500/20 text-emerald-200 border-emerald-400/40 whitespace-nowrap';
    } else if (node.branchTone === 'end') {
      branchBadgeEl.className =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border bg-slate-700/40 text-slate-300 border-slate-500/35 whitespace-nowrap';
    } else {
      branchBadgeEl.className =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border bg-blue-500/15 text-blue-200 border-blue-400/30 whitespace-nowrap';
    }
  }

  const rawSpeech = node.speech || '';
  if (speechEl) {
    const interpolated = account ? interpolateText(rawSpeech, account) : rawSpeech;
    speechEl.textContent = expandCommonAbbreviations(interpolated);
  }

  if (trailWrap && trailEl) {
    if (vfState.scriptFlow.pathNotes.length > 0) {
      trailWrap.classList.remove('hidden');
      trailEl.textContent = vfState.scriptFlow.pathNotes.join(' → ');
    } else {
      trailWrap.classList.add('hidden');
      trailEl.textContent = '';
    }
  }

  if (backBtn) {
    backBtn.disabled = vfState.scriptFlow.history.length === 0;
  }

  if (decisionWrap) {
    if (node.isTerminal) {
      decisionWrap.classList.add('hidden');
    } else {
      decisionWrap.classList.remove('hidden');
      if (yesBtn && yesHintEl) {
        const yHint = account ? expandCommonAbbreviations(interpolateText(node.yesHint || 'Avançar', account)) : (node.yesHint || 'Avançar');
        yesHintEl.textContent = yHint;
      }
      if (noBtn && noHintEl) {
        const nHint = account ? expandCommonAbbreviations(interpolateText(node.noHint || 'Registrar negativa', account)) : (node.noHint || 'Registrar negativa');
        noHintEl.textContent = nHint;
      }
    }
  }
}

function renderDossierAndScript() {
  const account = getActiveAccount();
  const { maxAttempts } = getProjectLimits();

  const empresaEl = document.getElementById('vf-lead-empresa');
  const icpAlertBanner = document.getElementById('vf-icp-alert-banner');
  const icpAlertSub = document.getElementById('vf-icp-alert-sub');
  const icpValidBadge = document.getElementById('vf-icp-valid-badge');
  const attemptBadge = document.getElementById('vf-lead-attempt-badge');
  const statusBadge = document.getElementById('vf-lead-status-badge');
  const rescueBtn = document.getElementById('vf-rescue-lead-btn');
  const reanalyzeBtn = document.getElementById('vf-reanalyze-brain-btn');
  const verticalEl = document.getElementById('vf-dossier-vertical');
  const employeesEl = document.getElementById('vf-dossier-employees');
  const processesEl = document.getElementById('vf-dossier-processes');
  const painWrap = document.getElementById('vf-dossier-pain-wrap');
  const painEl = document.getElementById('vf-dossier-pain');
  const hookWrap = document.getElementById('vf-dossier-hook-wrap');
  const hookEl = document.getElementById('vf-dossier-hook');
  const sysWrap = document.getElementById('vf-dossier-system-wrap');
  const sysEl = document.getElementById('vf-dossier-system');
  const personasEl = document.getElementById('vf-dossier-personas');
  const histWrap = document.getElementById('vf-dossier-history-wrap');
  const histEl = document.getElementById('vf-dossier-history');
  const nextFollowBadge = document.getElementById('vf-next-followup-badge');

  if (!account) {
    if (empresaEl) empresaEl.textContent = 'Selecione ou inicie uma empresa';
    icpAlertBanner?.classList.add('hidden');
    icpValidBadge?.classList.add('hidden');
    attemptBadge?.classList.add('hidden');
    statusBadge?.classList.add('hidden');
    rescueBtn?.classList.add('hidden');
    reanalyzeBtn?.classList.add('hidden');
    if (verticalEl) verticalEl.textContent = '—';
    if (employeesEl) employeesEl.textContent = 'A confirmar';
    if (processesEl) processesEl.textContent = 'Não estimado';
    painWrap?.classList.add('hidden');
    sysWrap?.classList.add('hidden');
    if (personasEl) personasEl.innerHTML = '<span class="text-xs text-slate-400">Sem mapeado</span>';
    histWrap?.classList.add('hidden');
    if (nextFollowBadge) nextFollowBadge.textContent = 'Próximo turno: automático';
    renderScriptInteractive(null);
    renderOutputCards(null);
    return;
  }

  reanalyzeBtn?.classList.remove('hidden');

  const isDiscarded = String(account.status || '').toLowerCase() === 'descartado';
  const attemptNum = Math.min(maxAttempts, Number(account.tentativa || 1));

  if (empresaEl) empresaEl.textContent = account.empresa;

  // ICP Alert vs Validated Badge
  const icpInfo = getAccountIcpStatus(account);
  if (icpInfo.state === 'below') {
    icpAlertBanner?.classList.remove('hidden');
    icpValidBadge?.classList.add('hidden');
    if (icpAlertSub) {
      icpAlertSub.textContent = icpInfo.text && icpInfo.text !== 'A confirmar'
        ? `Porte estimado identificado: ${icpInfo.text} funcionários.`
        : 'Porte identificado abaixo do perfil Enterprise (1.000+ funcionários).';
    }
  } else if (icpInfo.state === 'validated') {
    icpAlertBanner?.classList.add('hidden');
    icpValidBadge?.classList.remove('hidden');
  } else {
    icpAlertBanner?.classList.add('hidden');
    icpValidBadge?.classList.add('hidden');
  }

  const verticalLabel = (account.vertical || '—').trim();
  const employeesLabel = icpInfo.text || 'A confirmar';
  const processesLabel = formatCompactProcesses(account.processosTexto);

  if (verticalEl) {
    verticalEl.textContent = verticalLabel;
    verticalEl.title = verticalLabel;
  }
  if (employeesEl) {
    employeesEl.textContent = employeesLabel;
    employeesEl.title = employeesLabel;
  }
  if (processesEl) {
    processesEl.textContent = processesLabel;
    processesEl.title = processesLabel;
  }

  if (attemptBadge) {
    attemptBadge.classList.remove('hidden');
    if (isDiscarded || attemptNum >= maxAttempts) {
      attemptBadge.textContent = isDiscarded ? `Blackout (${attemptNum}/${maxAttempts})` : `Tentativa ${attemptNum}/${maxAttempts}`;
      attemptBadge.className =
        'text-xs font-semibold px-2.5 py-0.5 rounded-md border bg-rose-500/15 text-rose-300 border-rose-400/30 whitespace-nowrap';
    } else if (attemptNum === 2) {
      attemptBadge.textContent = `Tentativa ${attemptNum}/${maxAttempts}`;
      attemptBadge.className =
        'text-xs font-semibold px-2.5 py-0.5 rounded-md border bg-amber-500/15 text-amber-300 border-amber-400/30 whitespace-nowrap';
    } else {
      attemptBadge.textContent = `Tentativa ${attemptNum}/${maxAttempts}`;
      attemptBadge.className =
        'text-xs font-semibold px-2.5 py-0.5 rounded-md border bg-blue-500/15 text-blue-300 border-blue-400/30 whitespace-nowrap';
    }
  }

  if (statusBadge) {
    statusBadge.classList.remove('hidden');
    if (isDiscarded) {
      statusBadge.textContent = 'Descartado';
      statusBadge.className =
        'text-xs font-semibold px-2.5 py-0.5 rounded-md border bg-rose-500/15 text-rose-200 border-rose-400/35 whitespace-nowrap';
    } else {
      statusBadge.textContent = 'Ativo';
      statusBadge.className =
        'text-xs font-semibold px-2.5 py-0.5 rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-400/30 whitespace-nowrap';
    }
  }

  rescueBtn?.classList.toggle('hidden', !isDiscarded);

  // Dor Principal e Gancho Personalizado
  if (painWrap && painEl) {
    const painText = (account.dorEspecifica || account.variaveis?.dor_especifica || account.contexto || account.resumo || '').trim();
    const hookText = (account.ganchoPersonalizado || account.variaveis?.gancho_personalizado || '').trim();
    if (painText || hookText) {
      painWrap.classList.remove('hidden');
      painEl.textContent = painText || '—';
      if (hookWrap && hookEl) {
        if (hookText) {
          hookWrap.classList.remove('hidden');
          hookEl.textContent = hookText;
        } else {
          hookWrap.classList.add('hidden');
        }
      }
    } else {
      painWrap.classList.add('hidden');
    }
  }

  // Sistema Atual (EXIBIR APENAS software jurídico ou ERP confirmado)
  const confirmedSystem = filterRealEnterpriseSystem(account.sistemaAtual);
  if (sysWrap && sysEl) {
    if (confirmedSystem) {
      sysWrap.classList.remove('hidden');
      sysEl.textContent = confirmedSystem;
    } else {
      sysWrap.classList.add('hidden');
      sysEl.textContent = '';
    }
  }

  // Personas / Contatos ("Sem mapeado" se vazio)
  if (personasEl) {
    const rawList = Array.isArray(account.personasIdentificadas) ? account.personasIdentificadas : [];
    const validContacts = rawList.filter((p) => {
      const name = String(p?.nome || '').trim();
      return name && !/^(decisor(\s*principal)?|a confirmar|sem mapeado)$/i.test(name);
    });

    if (validContacts.length === 0) {
      const fallbackDecisor = String(account.decisor || '').trim();
      const hasFallbackContact =
        fallbackDecisor &&
        !/^(decisor(\s*principal)?|a confirmar|sem mapeado|diretoria jur[ií]dica|respons[aá]vel pela [aá]rea)$/i.test(fallbackDecisor);
      if (hasFallbackContact) {
        validContacts.push({
          nome: fallbackDecisor,
          cargo: account.cargo || '',
          perfil: account.persona || 'Jurídico',
          telefone: account.telefone || '',
          email: account.email || '',
        });
      }
    }

    if (validContacts.length === 0) {
      personasEl.innerHTML =
        '<span class="px-3 py-1.5 rounded-lg bg-[#070B14]/70 border border-sky-400/15 text-xs text-slate-400">Sem mapeado</span>';
    } else {
      personasEl.innerHTML = validContacts
        .map((p) => {
          const contactBits = [p.telefone, p.email].filter(Boolean).join(' · ');
          const personaTarget = p.perfil === 'Financeiro' ? 'Financeiro' : 'Jurídico';
          return `
          <button type="button" data-pick-persona="${escapeHtml(personaTarget)}"
            class="inline-flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl bg-[#070B14]/80 hover:bg-slate-800 border border-sky-400/20 text-xs text-slate-200 transition-colors text-left">
            <span class="inline-flex items-center gap-1.5">
              <span class="font-semibold text-cyan-300">${escapeHtml(p.perfil || 'Jurídico')}</span>
              <span>·</span>
              <span>${escapeHtml(p.nome)} ${p.cargo ? `(${escapeHtml(p.cargo)})` : ''}</span>
            </span>
            ${contactBits ? `<span class="text-[11px] text-slate-400">${escapeHtml(contactBits)}</span>` : ''}
          </button>`;
        })
        .join('');

      personasEl.querySelectorAll('[data-pick-persona]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const picked = btn.getAttribute('data-pick-persona') || 'Jurídico';
          const list = getProjectScriptsList();
          const matched = list.find((s) =>
            String(s.name || '').trim().toLowerCase().includes(picked.toLowerCase())
          );
          if (matched) {
            selectCockpitScript(matched);
          } else {
            vfState.activePersona = picked;
            renderScriptInteractive(account);
          }
        });
      });
    }
  }

  // Histórico de Interações
  if (histWrap && histEl) {
    const hist = Array.isArray(account.historico) ? account.historico : [];
    if (hist.length > 0) {
      histWrap.classList.remove('hidden');
      histEl.innerHTML = hist
        .slice(0, 6)
        .map((line) => `<li class="px-3 py-1.5 rounded-lg bg-[#070B14]/65 border border-sky-400/10">${escapeHtml(line)}</li>`)
        .join('');
    } else {
      histWrap.classList.add('hidden');
    }
  }

  if (nextFollowBadge) {
    const nextPreview = calculateNextFollowUp(attemptNum);
    nextFollowBadge.textContent = `Próx. turno: ${nextPreview.turn === 'tarde' ? 'Tarde' : 'Manhã'} (${nextPreview.slot})`;
  }

  renderScriptInteractive(account);
  renderOutputCards(account);
  refreshIcons();
}

function renderOutputCards(account) {
  const bitrixEl = document.getElementById('vf-output-bitrix');
  const subjWrap = document.getElementById('vf-output-subject-wrap');
  const subjEl = document.getElementById('vf-output-subject');
  const msgEl = document.getElementById('vf-output-message');
  const stageBadge = document.getElementById('vf-email-stage-badge');
  const copyMsgLabel = document.getElementById('vf-copy-message-label');
  const waOutEl = document.getElementById('vf-output-whatsapp');
  const waCopyBtn = document.getElementById('vf-copy-whatsapp-btn');

  if (!account) {
    if (bitrixEl) bitrixEl.textContent = 'Registre uma tentativa para gerar a Atualização do CRM pronta para copiar.';
    subjWrap?.classList.add('hidden');
    if (msgEl) msgEl.textContent = 'Selecione uma empresa para visualizar o e-mail sugerido sem abreviações.';
    if (stageBadge) stageBadge.textContent = 'E-mail 1';
    vfState.lastWhatsappText = '';
    if (waOutEl) {
      waOutEl.textContent = 'Clique em "+ Inserir Contexto / Conversa WhatsApp" para colar a conversa e gerar uma resposta personalizada sem abreviações.';
      waOutEl.className =
        'rounded-xl bg-[#0B1221]/85 border border-sky-400/15 p-4 text-xs sm:text-sm leading-relaxed text-slate-400 italic whitespace-pre-wrap font-sans min-h-[100px] max-h-64 overflow-y-auto';
    }
    if (waCopyBtn) waCopyBtn.disabled = true;
    return;
  }

  const attemptNum = Number(account.tentativa || 1);
  const { maxAttempts } = getProjectLimits();
  const isBlackout =
    String(account.status || '').toLowerCase() === 'descartado' ||
    attemptNum >= maxAttempts;

  const fallbackMsgs = buildFallbackMessages(account, isBlackout);
  const useRewritten = Boolean(account.emailRewrittenByInteraction);
  const emailSubject = useRewritten && account.lastEmailSubject ? account.lastEmailSubject : fallbackMsgs.emailSubject;
  const emailBody = useRewritten && account.lastEmailBody ? account.lastEmailBody : fallbackMsgs.emailBody;

  vfState.lastBitrixText =
    account.lastBitrixText ||
    buildBitrixOutput(account, account.proximoPasso, (account.historico && account.historico[0]) || '');
  vfState.lastMessageSubject = emailSubject;
  vfState.lastMessageBody = emailBody;

  if (bitrixEl) bitrixEl.textContent = vfState.lastBitrixText;

  if (stageBadge) {
    if (useRewritten && account.lastEmailStageLabel) {
      stageBadge.textContent = account.lastEmailStageLabel;
    } else if (isBlackout) {
      stageBadge.textContent = 'E-mail 3 (Blackout)';
    } else if (attemptNum === 2) {
      stageBadge.textContent = 'E-mail 2';
    } else {
      stageBadge.textContent = 'E-mail 1';
    }
  }

  subjWrap?.classList.remove('hidden');
  if (subjEl) subjEl.textContent = emailSubject;
  if (msgEl) msgEl.textContent = emailBody;
  if (copyMsgLabel) copyMsgLabel.textContent = 'Copiar E-mail';

  // Render Bloco 2: WhatsApp Contextual (IA)
  const contextualWa = String(account.contextualWhatsappBody || '').trim();
  vfState.lastWhatsappText = contextualWa;
  if (waOutEl) {
    if (contextualWa) {
      waOutEl.textContent = contextualWa;
      waOutEl.className =
        'rounded-xl bg-[#0B1221]/85 border border-emerald-400/25 p-4 text-xs sm:text-sm leading-relaxed text-slate-200 whitespace-pre-wrap font-sans min-h-[100px] max-h-64 overflow-y-auto';
    } else {
      waOutEl.textContent =
        'Clique em "+ Inserir Contexto / Conversa WhatsApp" para colar a conversa e gerar uma resposta personalizada sem abreviações.';
      waOutEl.className =
        'rounded-xl bg-[#0B1221]/85 border border-sky-400/15 p-4 text-xs sm:text-sm leading-relaxed text-slate-400 italic whitespace-pre-wrap font-sans min-h-[100px] max-h-64 overflow-y-auto';
    }
  }
  if (waCopyBtn) {
    waCopyBtn.disabled = !contextualWa;
  }
}

// ==========================================================================
// Stage 2: Clean Company Intake & Bitrix24 Raw Context Processing
// ==========================================================================
function setIntakeStatus(msg, type = 'info') {
  const el = document.getElementById('vf-intake-status');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove(
    'hidden',
    'bg-rose-500/10',
    'border-rose-500/30',
    'text-rose-300',
    'bg-emerald-500/10',
    'border-emerald-500/30',
    'text-emerald-300',
    'bg-blue-500/10',
    'border-blue-500/30',
    'text-blue-200'
  );
  if (type === 'error') el.classList.add('bg-rose-500/10', 'border-rose-500/30', 'text-rose-300');
  else if (type === 'success') el.classList.add('bg-emerald-500/10', 'border-emerald-500/30', 'text-emerald-300');
  else el.classList.add('bg-blue-500/10', 'border-blue-500/30', 'text-blue-200');
}

function resetBottomNextButtonStyle() {
  const bottomBtn = document.getElementById('vf-cockpit-next-bottom-btn');
  if (!bottomBtn) return;
  bottomBtn.className =
    'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-cyan-400/30 text-cyan-200 hover:text-white text-xs sm:text-sm font-semibold transition-all';
}

function highlightBottomNextButton() {
  const bottomBtn = document.getElementById('vf-cockpit-next-bottom-btn');
  if (!bottomBtn) return;
  bottomBtn.className =
    'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/45 text-emerald-200 hover:text-white text-xs sm:text-sm font-semibold shadow-lg shadow-emerald-600/15 transition-all';
}

function stopVoiceRecognitionIfActive() {
  if (vfState.isRecording && vfState.recognition) {
    try {
      vfState.recognition.stop();
    } catch {
      // ignore
    }
  }
}

function openAccountInCockpit(account) {
  stopVoiceRecognitionIfActive();
  vfState.activeAccountId = account.id;
  vfState.activePersona = account.persona || 'Jurídico';
  const matchedScript = getProjectScriptsList().find((s) =>
    String(s.name || '').trim().toLowerCase().includes(String(vfState.activePersona || '').toLowerCase())
  );
  vfState.activeScriptId = matchedScript?.id || getProjectScriptsList()[0]?.id || null;
  vfState.selectedChips.clear();
  document.querySelectorAll('.vf-quick-chip').forEach((c) => c.classList.remove('active'));
  const noteInput = document.getElementById('vf-interaction-input');
  if (noteInput) noteInput.value = '';
  document.getElementById('vf-voice-error')?.classList.add('hidden');
  setProcessStatus('');
  resetBottomNextButtonStyle();
  resetScriptFlow(false);
  saveAccountsLocal();
  renderDossierAndScript();
  switchCockpitTab('script');
  setStage('cockpit');
}

function returnToCleanIntake() {
  stopVoiceRecognitionIfActive();
  vfState.activeAccountId = null;
  localStorage.removeItem(projectStorageKey(VF_STORAGE.ACTIVE_LEAD_ID));
  vfState.selectedChips.clear();
  document.querySelectorAll('.vf-quick-chip').forEach((c) => c.classList.remove('active'));
  const noteInput = document.getElementById('vf-interaction-input');
  if (noteInput) noteInput.value = '';
  document.getElementById('vf-voice-error')?.classList.add('hidden');
  setProcessStatus('');
  resetBottomNextButtonStyle();

  const companyInput = document.getElementById('vf-intake-company-input');
  const bitrixInput = document.getElementById('vf-intake-bitrix-context');
  const existingBadge = document.getElementById('vf-intake-existing-badge');
  const dropdown = document.getElementById('vf-intake-dropdown');
  if (companyInput) companyInput.value = '';
  if (bitrixInput) bitrixInput.value = '';
  existingBadge?.classList.add('hidden');
  dropdown?.classList.add('hidden');
  setIntakeStatus('');

  setStage('intake');
  setTimeout(() => companyInput?.focus(), 60);
}

async function handleIntakeSubmit() {
  const companyInput = document.getElementById('vf-intake-company-input');
  const bitrixInput = document.getElementById('vf-intake-bitrix-context');
  const dropdown = document.getElementById('vf-intake-dropdown');
  dropdown?.classList.add('hidden');

  const query = String(companyInput?.value || '').trim().replace(/\s+/g, ' ');
  const rawBitrix = String(bitrixInput?.value || '').trim();
  if (!query) return;

  const btn = document.getElementById('vf-intake-submit-btn');
  const label = document.getElementById('vf-intake-submit-label');
  if (btn) btn.disabled = true;

  try {
    const existing = vfState.accounts.find(
      (a) => a.empresa.trim().replace(/\s+/g, ' ').toLowerCase() === query.toLowerCase()
    );

    if (existing) {
      if (rawBitrix) {
        if (label) label.textContent = 'Mesclando contexto com IA...';
        setIntakeStatus(
          `Empresa "${existing.empresa}" encontrada em vf_leads. Mesclando novos dados do Bitrix24 com IA...`,
          'info'
        );
        await mergeBitrixContextWithGemini(existing, rawBitrix);
        saveAccountsLocal();
        await syncLeadToSupabase(existing);
      }
      setIntakeStatus('');
      openAccountInCockpit(existing);
      return;
    }

    // New company -> Gemini + Google Search + Bitrix24 context + Markdown KB
    if (label) label.textContent = 'Pesquisando & Estruturando...';
    setIntakeStatus(
      `Pesquisando "${query}" via Google Search e cruzando${rawBitrix ? ' com o contexto do Bitrix24 e' : ''} a Base de Conhecimento Markdown...`,
      'info'
    );

    const newLead = await researchNewCompanyWithGemini(query, rawBitrix);
    vfState.accounts.unshift(newLead);
    vfState.activeAccountId = newLead.id;
    vfState.activePersona = newLead.persona;
    saveAccountsLocal();
    await syncLeadToSupabase(newLead);

    setIntakeStatus('');
    openAccountInCockpit(newLead);
    showToast(`Dossiê de "${newLead.empresa}" criado com ${newLead.cases.length} cases!`);
  } catch (err) {
    setIntakeStatus(`Falha ao processar empresa: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Pesquisar & Abrir Empresa';
  }
}

function initIntakeForm() {
  const input = document.getElementById('vf-intake-company-input');
  const dropdown = document.getElementById('vf-intake-dropdown');
  const existingBadge = document.getElementById('vf-intake-existing-badge');
  const form = document.getElementById('vf-intake-form');
  if (!input || !dropdown || !form) return;

  function updateExistingHint() {
    const q = input.value.trim().toLowerCase();
    const isMatch = q.length > 0 && vfState.accounts.some((a) => a.empresa.toLowerCase() === q);
    existingBadge?.classList.toggle('hidden', !isMatch);
  }

  function renderDropdown(qRaw) {
    const q = qRaw.trim().toLowerCase();
    const matches = vfState.accounts.filter((acc) => {
      if (!q) return true;
      return (
        acc.empresa.toLowerCase().includes(q) ||
        (acc.decisor || '').toLowerCase().includes(q) ||
        (acc.vertical || '').toLowerCase().includes(q)
      );
    });

    dropdown.innerHTML = '';

    matches.slice(0, 7).forEach((acc) => {
      const isDisc = String(acc.status || '').toLowerCase() === 'descartado';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-full text-left px-4 py-3 hover:bg-blue-600/15 border-b border-sky-400/10 flex items-center justify-between gap-3 transition-colors';
      btn.innerHTML = `
        <div class="min-w-0">
          <p class="text-xs sm:text-sm font-semibold text-[#F8FAFC] truncate">${escapeHtml(acc.empresa)}</p>
          <p class="text-[11px] text-[#94A3B8] truncate">${escapeHtml(acc.vertical)} · ${escapeHtml(acc.decisor || 'Decisor')}</p>
        </div>
        <span class="text-[11px] font-medium px-2 py-0.5 rounded-md ${
          isDisc
            ? 'bg-rose-500/15 text-rose-300 border border-rose-400/25'
            : 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/25'
        } whitespace-nowrap shrink-0">
          ${isDisc ? 'Descartado' : `Tentativa ${acc.tentativa}/${getProjectLimits().maxAttempts}`}
        </span>
      `;
      btn.addEventListener('click', () => {
        input.value = acc.empresa;
        updateExistingHint();
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(btn);
    });

    if (dropdown.children.length > 0) {
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  }

  input.addEventListener('focus', () => {
    updateExistingHint();
    renderDropdown(input.value);
  });
  input.addEventListener('input', () => {
    updateExistingHint();
    renderDropdown(input.value);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleIntakeSubmit();
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// ==========================================================================
// Voice Recognition (SpeechRecognition pt-BR, continuous + interimResults)
// ==========================================================================
function setVoiceButtonListeningUI(isListening) {
  const btn = document.getElementById('vf-voice-btn');
  const label = document.getElementById('vf-voice-btn-label');
  const statusEl = document.getElementById('vf-voice-status');

  if (btn) {
    btn.className = isListening
      ? 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 border border-rose-300/70 text-xs font-semibold text-white shadow-lg shadow-rose-900/40 animate-pulse transition-all'
      : 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-blue-600/30 border border-sky-400/25 text-xs font-semibold text-cyan-300 hover:text-white transition-all';
  }
  if (label) {
    label.textContent = isListening ? 'Ouvindo... (Clique para parar)' : 'Ditar por Voz (pt-BR)';
  }
  if (statusEl) {
    statusEl.classList.toggle('hidden', !isListening);
  }
}

function showVoiceErrorNotice(message = '') {
  const errEl = document.getElementById('vf-voice-error');
  if (!errEl) return;
  if (!message) {
    errEl.classList.add('hidden');
    errEl.textContent = '';
    return;
  }
  errEl.textContent = message;
  errEl.classList.remove('hidden');
}

function toggleVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const msg = 'Reconhecimento de voz não suportado neste navegador. Utilize Chrome ou Edge atualizados.';
    showVoiceErrorNotice(msg);
    showToast(msg);
    return;
  }

  const textarea = document.getElementById('vf-interaction-input');
  showVoiceErrorNotice('');

  if (vfState.isRecording && vfState.recognition) {
    try {
      vfState.recognition.stop();
    } catch {
      vfState.isRecording = false;
      setVoiceButtonListeningUI(false);
    }
    return;
  }

  const existingText = textarea ? textarea.value : '';
  vfState.voiceBaseText = existingText
    ? (/\s$/.test(existingText) ? existingText : `${existingText} `)
    : '';
  vfState.voiceFinalText = '';
  vfState.voiceInterimText = '';

  const recognition = new SpeechRec();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    vfState.isRecording = true;
    setVoiceButtonListeningUI(true);
  };

  recognition.onresult = (event) => {
    let finalChunk = '';
    let interimChunk = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = event.results[i]?.[0]?.transcript || '';
      if (event.results[i]?.isFinal) {
        finalChunk += `${transcript.trim()} `;
      } else {
        interimChunk += transcript;
      }
    }
    vfState.voiceFinalText = finalChunk;
    vfState.voiceInterimText = interimChunk;
    if (textarea) {
      const nextVal = `${vfState.voiceBaseText}${finalChunk}${interimChunk}`;
      textarea.value = nextVal;
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  recognition.onerror = (event) => {
    const errCode = String(event?.error || '');
    vfState.isRecording = false;
    vfState.recognition = null;
    setVoiceButtonListeningUI(false);

    if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
      const inIframe = window.self !== window.top;
      const notice = inIframe
        ? 'Acesso ao microfone bloqueado (not-allowed) neste navegador ou iframe de pré-visualização. Libere a permissão do microfone no ícone ao lado do endereço na barra do navegador ou abra o aplicativo em uma nova aba.'
        : 'Permissão do microfone bloqueada (not-allowed). Clique no ícone de cadeado/microfone na barra de endereço do navegador para liberar o acesso e tente novamente.';
      showVoiceErrorNotice(notice);
      showToast('Permissão de microfone bloqueada no navegador.');
    } else if (errCode === 'audio-capture') {
      const notice = 'Nenhum microfone detectado no dispositivo. Verifique se há um microfone conectado e ativo.';
      showVoiceErrorNotice(notice);
      showToast(notice);
    } else if (errCode === 'no-speech') {
      showVoiceErrorNotice('Nenhuma fala detectada no microfone. Clique novamente em Ditar por Voz para tentar de novo.');
    } else if (errCode && errCode !== 'aborted') {
      showVoiceErrorNotice(`Erro no reconhecimento de voz (${errCode}). Tente novamente ou abra o app em uma nova aba.`);
    }
  };

  recognition.onend = () => {
    vfState.isRecording = false;
    vfState.recognition = null;
    setVoiceButtonListeningUI(false);
    if (textarea && (vfState.voiceFinalText || vfState.voiceInterimText)) {
      textarea.value = `${vfState.voiceBaseText}${vfState.voiceFinalText}${vfState.voiceInterimText}`.trimEnd();
    }
  };

  vfState.recognition = recognition;
  try {
    recognition.start();
  } catch (err) {
    vfState.isRecording = false;
    vfState.recognition = null;
    setVoiceButtonListeningUI(false);
    showVoiceErrorNotice(
      `Não foi possível iniciar o microfone (${err?.message || 'permissão bloqueada'}). Libere a permissão na barra de endereço ou abra em nova aba.`
    );
  }
}

// ==========================================================================
// Tab 4: WhatsApp Contextual (IA) Modal + Voice Recognition (pt-BR)
// ==========================================================================
function setWaVoiceButtonListeningUI(isListening) {
  const btn = document.getElementById('vf-wa-voice-btn');
  const label = document.getElementById('vf-wa-voice-btn-label');
  const statusEl = document.getElementById('vf-wa-voice-status');

  if (btn) {
    btn.className = isListening
      ? 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 border border-rose-300/70 text-xs font-semibold text-white shadow-lg shadow-rose-900/40 animate-pulse transition-all'
      : 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-blue-600/30 border border-sky-400/25 text-xs font-semibold text-cyan-300 hover:text-white transition-all';
  }
  if (label) {
    label.textContent = isListening ? 'Ouvindo... (Clique para parar)' : 'Ditar por Voz (pt-BR)';
  }
  if (statusEl) {
    statusEl.classList.toggle('hidden', !isListening);
  }
}

function showWaVoiceErrorNotice(message = '') {
  const errEl = document.getElementById('vf-wa-voice-error');
  if (!errEl) return;
  if (!message) {
    errEl.classList.add('hidden');
    errEl.textContent = '';
    return;
  }
  errEl.textContent = message;
  errEl.classList.remove('hidden');
}

function setWaModalStatus(message = '', type = 'info') {
  const el = document.getElementById('vf-wa-modal-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden', 'text-cyan-300', 'text-rose-300', 'text-emerald-300');
  if (type === 'error') el.classList.add('text-rose-300');
  else if (type === 'success') el.classList.add('text-emerald-300');
  else el.classList.add('text-cyan-300');
}

function stopWaVoiceIfActive() {
  if (vfState.isWaRecording && vfState.waRecognition) {
    try {
      vfState.waRecognition.stop();
    } catch {
      // ignore
    }
  }
  vfState.isWaRecording = false;
  vfState.waRecognition = null;
  setWaVoiceButtonListeningUI(false);
}

function toggleWhatsappVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const msg = 'Reconhecimento de voz não suportado neste navegador. Utilize Chrome ou Edge atualizados.';
    showWaVoiceErrorNotice(msg);
    showToast(msg);
    return;
  }

  const textarea = document.getElementById('vf-wa-direction-input');
  showWaVoiceErrorNotice('');

  if (vfState.isWaRecording && vfState.waRecognition) {
    try {
      vfState.waRecognition.stop();
    } catch {
      vfState.isWaRecording = false;
      setWaVoiceButtonListeningUI(false);
    }
    return;
  }

  const existingText = textarea ? textarea.value : '';
  vfState.waVoiceBaseText = existingText
    ? (/\s$/.test(existingText) ? existingText : `${existingText} `)
    : '';
  vfState.waVoiceFinalText = '';
  vfState.waVoiceInterimText = '';

  const recognition = new SpeechRec();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    vfState.isWaRecording = true;
    setWaVoiceButtonListeningUI(true);
  };

  recognition.onresult = (event) => {
    let finalChunk = '';
    let interimChunk = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = event.results[i]?.[0]?.transcript || '';
      if (event.results[i]?.isFinal) {
        finalChunk += `${transcript.trim()} `;
      } else {
        interimChunk += transcript;
      }
    }
    vfState.waVoiceFinalText = finalChunk;
    vfState.waVoiceInterimText = interimChunk;
    if (textarea) {
      textarea.value = `${vfState.waVoiceBaseText}${finalChunk}${interimChunk}`;
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  recognition.onerror = (event) => {
    const errCode = String(event?.error || '');
    vfState.isWaRecording = false;
    vfState.waRecognition = null;
    setWaVoiceButtonListeningUI(false);

    if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
      const inIframe = window.self !== window.top;
      const notice = inIframe
        ? 'Acesso ao microfone bloqueado neste navegador ou iframe. Libere o microfone na barra de endereço ou abra em nova aba.'
        : 'Permissão do microfone bloqueada. Clique no ícone da barra de endereço para liberar o acesso e tente novamente.';
      showWaVoiceErrorNotice(notice);
      showToast('Permissão de microfone bloqueada.');
    } else if (errCode === 'audio-capture') {
      showWaVoiceErrorNotice('Nenhum microfone detectado no dispositivo.');
    } else if (errCode === 'no-speech') {
      showWaVoiceErrorNotice('Nenhuma fala detectada. Clique novamente em Ditar por Voz para tentar de novo.');
    } else if (errCode && errCode !== 'aborted') {
      showWaVoiceErrorNotice(`Erro no reconhecimento de voz (${errCode}).`);
    }
  };

  recognition.onend = () => {
    vfState.isWaRecording = false;
    vfState.waRecognition = null;
    setWaVoiceButtonListeningUI(false);
    if (textarea && (vfState.waVoiceFinalText || vfState.waVoiceInterimText)) {
      textarea.value = `${vfState.waVoiceBaseText}${vfState.waVoiceFinalText}${vfState.waVoiceInterimText}`.trimEnd();
    }
  };

  vfState.waRecognition = recognition;
  try {
    recognition.start();
  } catch (err) {
    vfState.isWaRecording = false;
    vfState.waRecognition = null;
    setWaVoiceButtonListeningUI(false);
    showWaVoiceErrorNotice(
      `Não foi possível iniciar o microfone (${err?.message || 'permissão bloqueada'}).`
    );
  }
}

function openWhatsappContextModal() {
  const account = getActiveAccount();
  if (!account) {
    showToast('Selecione ou inicie uma empresa antes de gerar o WhatsApp contextual.');
    return;
  }
  const modal = document.getElementById('vf-wa-context-modal');
  const companyEl = document.getElementById('vf-wa-modal-company');
  const historyEl = document.getElementById('vf-wa-history-input');
  const directionEl = document.getElementById('vf-wa-direction-input');
  if (!modal) return;

  if (companyEl) {
    const safeLead = isMissingDecisorName(account.decisor) ? '[Nome do Lead]' : account.decisor;
    companyEl.textContent = `${account.empresa} · ${safeLead}`;
  }
  if (historyEl) historyEl.value = account.contextualWaHistory || '';
  if (directionEl) directionEl.value = account.contextualWaDirection || '';

  showWaVoiceErrorNotice('');
  setWaModalStatus('');
  stopWaVoiceIfActive();

  modal.classList.remove('hidden');
  refreshIcons();
  setTimeout(() => historyEl?.focus(), 50);
}

function closeWhatsappContextModal() {
  stopWaVoiceIfActive();
  setWaModalStatus('');
  showWaVoiceErrorNotice('');
  document.getElementById('vf-wa-context-modal')?.classList.add('hidden');
}

async function generateContextualWhatsappWithGemini(account, waHistory, waDirection) {
  const [date1, date2] = getNextBusinessDays(2).map((d) => d.label);
  const kbContext = getKnowledgeContextText().slice(0, 3000);
  const safeDecisor = isMissingDecisorName(account?.decisor) ? '[Nome do Lead]' : account.decisor;
  const recentHistory = Array.isArray(account?.historico) && account.historico.length > 0
    ? account.historico.slice(0, 5).map((h) => `- ${h}`).join('\n')
    : '- Sem histórico anterior.';

  const prompt = `Você é um especialista em prospecção consultiva B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Escreva UMA mensagem curta e natural de resposta para WhatsApp com base no histórico colado da conversa e no direcionamento exato dado pelo usuário.

DOSSIÊ DA EMPRESA ATIVA:
- Empresa: ${account.empresa}
- Vertical: ${account.vertical}
- Funcionários estimados: ${account.funcionariosTexto || 'A confirmar'}
- Processos estimados: ${account.processosTexto || 'Não estimado'}
- Decisor: ${safeDecisor} (${account.cargo || 'Executivo'})
- Dores / Contexto: ${account.contexto || account.resumo || 'Governança e previsibilidade operacional'}
- Gancho personalizado: ${account.ganchoPersonalizado || 'Não informado'}
- Cases de referência na vertical: ${(account.cases || []).join(', ')}

HISTÓRICO RECENTE NO CRM:
${recentHistory}

BASE DE CONHECIMENTO (RESUMO):
${kbContext}

HISTÓRICO DA CONVERSA NO WHATSAPP (COLADO PELO VENDEDOR):
"""
${waHistory || '(Sem histórico colado — gere abordagem pontual de WhatsApp conforme o direcionamento)'}
"""

DIRECIONAMENTO / TOM DE VOZ DO VENDEDOR:
"""
${waDirection || 'Responda de forma leve e objetiva, puxando para uma conversa rápida amanhã na janela matinal (09h30 ou 10h00).'}
"""

REGRAS OBRIGATÓRIAS:
1. PROIBIDO usar jargões técnicos de tecnologia ou informática (nunca use termos como API, cloud, SaaS, microsserviço, webhook, deploy, banco de dados, integração técnica, software house) — use linguagem executiva natural de negócios.
2. PRIORIZE AGENDA MATINAL: sempre que sugerir horário para conversa ou retorno, use exclusivamente horários pela manhã (09h30, 10h00 ou 10h30, por exemplo ${date1} ou ${date2} às 09h30 ou 10h00).
3. PROIBIDO QUALQUER ABREVIAÇÃO: nunca use "min", "att", "vc", "vcs", "pq", "obs", "Dr.", "Dra.", "tel.", "cel.", "aprox.", "msg", "tb", "tbm" — escreva sempre todas as palavras por extenso ("minutos", "atenciosamente", "você", "vocês", "porque", "doutor", "doutora", "telefone", "celular", "aproximadamente", "mensagem", "também").
4. Se o decisor não estiver mapeado, use exatamente "[Nome do Lead]" sem artigos soltos antes (ex: "Olá [Nome do Lead],").
5. FORMATO DE WHATSAPP: mensagem curta (2 a 4 parágrafos curtos / 3 a 6 linhas), leve, humana e pronta para enviar no WhatsApp.

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "whatsappMensagem": "texto final curto e natural para WhatsApp, 100% sem abreviações"
}`;

  const { text } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: false,
    systemInstruction: getEffectivePlaybookRules(),
  });

  try {
    const parsed = parseJsonFromGeminiText(text);
    const msg = String(parsed?.whatsappMensagem || parsed?.mensagem || parsed?.whatsapp || '').trim();
    if (msg) return expandCommonAbbreviations(msg);
  } catch {
    // fallback if Gemini returns raw text
  }

  return expandCommonAbbreviations(
    String(text || '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
  );
}

async function handleGenerateContextualWhatsapp() {
  const account = getActiveAccount();
  if (!account) {
    showToast('Selecione uma empresa antes de gerar a mensagem.');
    return;
  }
  if (vfState.isProcessingAi) return;

  stopWaVoiceIfActive();

  const historyInput = document.getElementById('vf-wa-history-input');
  const directionInput = document.getElementById('vf-wa-direction-input');
  const btn = document.getElementById('vf-wa-generate-btn');
  const label = document.getElementById('vf-wa-generate-label');

  const waHistory = (historyInput?.value || '').trim();
  const waDirection = (directionInput?.value || '').trim();

  if (!waHistory && !waDirection) {
    setWaModalStatus('Cole o histórico da conversa ou informe/dite o direcionamento antes de gerar.', 'error');
    historyInput?.focus();
    return;
  }

  vfState.isProcessingAi = true;
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Gerando mensagem...';
  setWaModalStatus('Analisando conversa, dossiê e Cérebro da IA (sem abreviações)...', 'info');

  try {
    const generatedMsg = await generateContextualWhatsappWithGemini(account, waHistory, waDirection);
    if (!generatedMsg) {
      throw new Error('A IA retornou uma resposta vazia.');
    }

    account.contextualWaHistory = waHistory;
    account.contextualWaDirection = waDirection;
    account.contextualWhatsappBody = generatedMsg;
    saveAccountsLocal();

    renderOutputCards(account);
    closeWhatsappContextModal();
    showToast('Mensagem de WhatsApp gerada e pronta para copiar!');
  } catch (err) {
    setWaModalStatus(`Falha ao gerar mensagem: ${err.message}`, 'error');
  } finally {
    vfState.isProcessingAi = false;
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Gerar Mensagem & Voltar';
  }
}

function setProcessStatus(msg, type = 'info') {
  const el = document.getElementById('vf-process-status');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove(
    'hidden',
    'bg-rose-500/10',
    'border-rose-500/30',
    'text-rose-300',
    'bg-emerald-500/10',
    'border-emerald-500/30',
    'text-emerald-300',
    'bg-blue-500/10',
    'border-blue-500/30',
    'text-blue-200'
  );
  if (type === 'error') el.classList.add('bg-rose-500/10', 'border-rose-500/30', 'text-rose-300');
  else if (type === 'success') el.classList.add('bg-emerald-500/10', 'border-emerald-500/30', 'text-emerald-300');
  else el.classList.add('bg-blue-500/10', 'border-blue-500/30', 'text-blue-200');
}

async function handleProcessAndRegisterAttempt() {
  const account = getActiveAccount();
  if (!account) {
    showToast('Selecione ou inicie uma empresa antes de registrar a tentativa.');
    return;
  }
  if (vfState.isProcessingAi) return;

  const textarea = document.getElementById('vf-interaction-input');
  const noteText = (textarea?.value || '').trim();
  const chips = Array.from(vfState.selectedChips);
  const combinedInput = [chips.length > 0 ? `Tags rápidas: ${chips.join(', ')}` : '', noteText]
    .filter(Boolean)
    .join('\n');

  if (!combinedInput) {
    setProcessStatus('Selecione ao menos um chip rápido, fale no microfone ou cole uma observação/transcrição.', 'error');
    return;
  }

  const { maxAttempts } = getProjectLimits();
  const prevAttempt = Math.max(1, Number(account.tentativa || 1));
  const isBlackout = prevAttempt >= maxAttempts;
  const nextAttempt = isBlackout ? maxAttempts : prevAttempt + 1;
  const nextFollowUp = calculateNextFollowUp(prevAttempt);
  const stageMeta = resolveEmailStageForAttempt(prevAttempt, chips, isBlackout);

  const btn = document.getElementById('vf-process-attempt-btn');
  const label = document.getElementById('vf-process-attempt-label');
  vfState.isProcessingAi = true;
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Processando tentativa...';

  try {
    setProcessStatus('Combinando chips, transcrição, histórico e Cérebro da IA para gerar CRM e E-mail...', 'info');
    const aiResult = await processInteractionWithGemini(
      account,
      combinedInput,
      nextAttempt,
      isBlackout,
      nextFollowUp,
      chips
    );

    // 1. Update lead metadata, direct phones/emails & discovered contacts (persisted to vf_leads)
    if (aiResult?.sistemaAtual) {
      const filteredSys = filterRealEnterpriseSystem(aiResult.sistemaAtual);
      if (filteredSys) account.sistemaAtual = filteredSys;
    }
    if (aiResult?.novasDores) {
      account.contexto = expandCommonAbbreviations(String(aiResult.novasDores).trim());
    }

    const directPhone = String(aiResult?.telefoneDireto || aiResult?.novoContato?.telefone || '').trim();
    const directEmail = String(aiResult?.emailDireto || aiResult?.novoContato?.email || '').trim();
    if (directPhone) {
      account.telefone = directPhone;
    }
    if (directEmail) {
      account.email = directEmail;
    }

    if (aiResult?.novoContato?.nome && !isMissingDecisorName(aiResult.novoContato.nome)) {
      const nc = aiResult.novoContato;
      const cleanName = expandCommonAbbreviations(String(nc.nome).trim());
      const cleanCargo = expandCommonAbbreviations(String(nc.cargo || '').trim()) || 'Contato identificado';
      const cleanTel = String(nc.telefone || aiResult?.telefoneDireto || '').trim();
      const cleanMail = String(nc.email || aiResult?.emailDireto || '').trim();
      const cleanPerfil = nc.perfil === 'Financeiro' ? 'Financeiro' : 'Jurídico';

      if (!Array.isArray(account.personasIdentificadas)) account.personasIdentificadas = [];
      const existingPersona = account.personasIdentificadas.find(
        (p) => (p.nome || '').toLowerCase() === cleanName.toLowerCase()
      );
      if (existingPersona) {
        if (cleanCargo && !existingPersona.cargo) existingPersona.cargo = cleanCargo;
        if (cleanTel) existingPersona.telefone = cleanTel;
        if (cleanMail) existingPersona.email = cleanMail;
      } else {
        account.personasIdentificadas.push({
          nome: cleanName,
          cargo: cleanCargo,
          perfil: cleanPerfil,
          telefone: cleanTel,
          email: cleanMail,
        });
      }

      if (isMissingDecisorName(account.decisor)) {
        account.decisor = cleanName;
        if (cleanCargo && cleanCargo !== 'Contato identificado') account.cargo = cleanCargo;
        if (cleanTel) account.telefone = cleanTel;
        if (cleanMail) account.email = cleanMail;
      }
    } else if (directPhone || directEmail) {
      if (directPhone) account.telefone = directPhone;
      if (directEmail) account.email = directEmail;
    }

    const rawSummary =
      aiResult?.resumoInteracao ||
      (chips.length > 0 ? `${chips.join(' + ')}${noteText ? ` — ${noteText}` : ''}` : noteText.slice(0, 140));
    const summary = expandCommonAbbreviations(rawSummary);

    const timestamp = formatNowTimestamp();
    const historyLine = `${timestamp} | Tentativa ${prevAttempt}/${maxAttempts} — ${summary}`;
    account.historico = [historyLine, ...(account.historico || [])].slice(0, 15);
    account.lastNote = summary;

    // 2. Attempt counter, blackout rule & follow-up schedule
    if (isBlackout) {
      account.tentativa = maxAttempts;
      account.status = 'descartado';
      account.proximoPasso = 'Ciclo encerrado — E-mail de Blackout gerado';
    } else {
      account.tentativa = nextAttempt;
      account.status = 'ativo';
      account.proximoPasso = nextFollowUp.label;
      commitFollowUpSchedule(nextFollowUp.iso);
    }

    if (aiResult?.scriptJuridico && !isBlackout) {
      account.scriptJuridico = expandCommonAbbreviations(aiResult.scriptJuridico);
      account.scriptRewrittenByInteraction = true;
    }
    if (aiResult?.scriptFinanceiro && !isBlackout) {
      account.scriptFinanceiro = expandCommonAbbreviations(aiResult.scriptFinanceiro);
      account.scriptRewrittenByInteraction = true;
    }

    // 3. Output blocks (Tab 3 Atualização do CRM + Tab 4 Email/WhatsApp without abbreviations)
    const signature = getProjectSignature();
    const fallbackMsgs = buildFallbackMessages(
      { ...account, tentativa: stageMeta.stageKey === 'email1' ? 1 : stageMeta.stageKey === 'email3' ? maxAttempts : 2 },
      isBlackout
    );
    const crmUpdateText = expandCommonAbbreviations(String(aiResult?.atualizacaoCrm || '').trim());
    account.lastBitrixText = crmUpdateText || buildBitrixOutput(account, account.proximoPasso, historyLine);

    account.lastEmailStageLabel = stageMeta.stageBadge;
    account.lastEmailSubject = expandCommonAbbreviations(aiResult?.emailAssunto || fallbackMsgs.emailSubject);
    account.lastEmailBody = aiResult?.emailCorpo
      ? preserveMultilineSignature(expandCommonAbbreviations(aiResult.emailCorpo), signature, true)
      : fallbackMsgs.emailBody;
    account.lastWhatsappBody = aiResult?.whatsappCorpo
      ? preserveMultilineSignature(expandCommonAbbreviations(aiResult.whatsappCorpo), signature, true)
      : fallbackMsgs.whatsappBody;
    account.emailRewrittenByInteraction = Boolean(aiResult?.emailCorpo || aiResult?.emailAssunto);

    if (isBlackout) {
      vfState.selectedOutChannel = 'email';
    }

    // 4. Daily scoreboard update (Novas vs Follow-ups)
    if (prevAttempt === 1 && !account.countedAsNovaToday && !account.wasRescued) {
      vfState.dailyStats.novas += 1;
      account.countedAsNovaToday = true;
    } else {
      vfState.dailyStats.followups += 1;
    }

    saveAccountsLocal();
    saveStatsLocal();
    await syncLeadToSupabase(account);
    await logInteractionToSupabase(account, chips.join(',') || 'registro', 'Ligação / CRM', historyLine);
    await syncDailyStatsToSupabase();

    // Clear inputs
    if (textarea) textarea.value = '';
    vfState.selectedChips.clear();
    document.querySelectorAll('.vf-quick-chip').forEach((c) => c.classList.remove('active'));

    renderScoreboard();
    renderDossierAndScript();
    highlightBottomNextButton();
    setProcessStatus('');
    switchCockpitTab('bitrix');
    showToast(
      isBlackout
        ? '3ª tentativa registrada — Atualização do CRM pronta e E-mail de Blackout gerado.'
        : `Tentativa ${prevAttempt}/${maxAttempts} registrada! Atualização do CRM pronta.`
    );
  } catch (err) {
    setProcessStatus(`Falha ao processar tentativa com IA: ${err.message}`, 'error');
  } finally {
    vfState.isProcessingAi = false;
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Processar & Registrar Tentativa';
  }
}

async function handleRescueLead() {
  const account = getActiveAccount();
  if (!account) return;
  account.status = 'ativo';
  account.tentativa = 1;
  account.wasRescued = true;
  account.proximoPasso = calculateNextFollowUp(1).label;
  const line = `${formatNowTimestamp()} | Lead resgatado para nova cadência (Tentativa 1/${getProjectLimits().maxAttempts}).`;
  account.historico = [line, ...(account.historico || [])].slice(0, 15);
  account.lastBitrixText = buildBitrixOutput(account, account.proximoPasso, line);
  feedAccountTemplatesFromProject(account);

  saveAccountsLocal();
  await syncLeadToSupabase(account);
  await logInteractionToSupabase(account, 'resgate', 'CRM', line);
  renderDossierAndScript();
  showToast(`Lead "${account.empresa}" resgatado com sucesso!`);
}

async function handleDiscardByIcp() {
  const account = getActiveAccount();
  if (!account) return;
  const icpInfo = getAccountIcpStatus(account);
  const countNote = icpInfo.text && icpInfo.text !== 'A confirmar' ? ` (${icpInfo.text})` : '';
  const line = `${formatNowTimestamp()} | Descartado por perfil — abaixo de 1.000 funcionários${countNote}.`;

  account.status = 'descartado';
  account.proximoPasso = 'Descartado por perfil (abaixo de 1.000 funcionários)';
  account.lastNote = 'Descartado por perfil (Fora de ICP Enterprise).';
  account.historico = [line, ...(account.historico || [])].slice(0, 15);
  account.lastBitrixText = buildBitrixOutput(account, account.proximoPasso, line);

  saveAccountsLocal();
  await syncLeadToSupabase(account);
  await logInteractionToSupabase(account, 'descarte_icp', 'ICP', line);
  renderDossierAndScript();
  showToast(`"${account.empresa}" descartada por perfil (fora do ICP Enterprise).`);
}

async function handleReanalyzeWithBrain() {
  const account = getActiveAccount();
  if (!account || vfState.isProcessingAi) return;

  const btn = document.getElementById('vf-reanalyze-brain-btn');
  const label = document.getElementById('vf-reanalyze-brain-label');
  vfState.isProcessingAi = true;
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Atualizando com Cérebro IA...';

  try {
    await reanalyzeAccountWithBrain(account);
    saveAccountsLocal();
    await syncLeadToSupabase(account);
    renderDossierAndScript();
    showToast(`Análise de "${account.empresa}" atualizada com o Cérebro da IA!`);
  } catch (err) {
    showToast(`Falha ao reanalisar com Cérebro da IA: ${err.message}`);
  } finally {
    vfState.isProcessingAi = false;
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Atualizar Análise com Cérebro IA';
  }
}

// ==========================================================================
// Modal: Configurar Projeto (4 Abas)
// ==========================================================================
function cancelDeleteKnowledgeDoc() {
  pendingDeleteKbDocId = null;
  document.getElementById('vf-kb-delete-confirm')?.classList.add('hidden');
}

function promptDeleteKnowledgeDoc(docId) {
  const doc = vfState.knowledgeDocs.find((d) => d.id === docId);
  if (!doc) return;
  pendingDeleteKbDocId = doc.id;
  const box = document.getElementById('vf-kb-delete-confirm');
  const nameEl = document.getElementById('vf-kb-delete-confirm-name');
  if (nameEl) nameEl.textContent = doc.title;
  box?.classList.remove('hidden');
}

async function executeDeleteKnowledgeDoc(docId) {
  const targetDoc = vfState.knowledgeDocs.find((d) => d.id === docId);
  if (!targetDoc) {
    cancelDeleteKnowledgeDoc();
    return;
  }

  if (isCloudActive()) {
    try {
      if (isUuid(targetDoc.id)) {
        const { error } = await vfState.supabaseClient
          .from('vf_knowledge_docs')
          .delete()
          .eq('id', targetDoc.id);
        if (error) throw error;
      } else if (isUuid(vfState.activeProject?.id)) {
        const { error } = await vfState.supabaseClient
          .from('vf_knowledge_docs')
          .delete()
          .eq('project_id', vfState.activeProject.id)
          .eq('title', targetDoc.title);
        if (error) throw error;
      }
    } catch (err) {
      showToast(`Erro ao remover do Supabase: ${err.message}`);
      return;
    }
  }

  vfState.knowledgeDocs = vfState.knowledgeDocs.filter((d) => d.id !== targetDoc.id);
  if (vfState.activeKbDocId === targetDoc.id) {
    vfState.activeKbDocId = vfState.knowledgeDocs[0]?.id || null;
  }
  cancelDeleteKnowledgeDoc();
  saveKnowledgeLocal();
  renderKbDocsList();
  showToast('Documento removido da base de conhecimento.');
}

function switchConfigTab(tabName) {
  cancelDeleteKnowledgeDoc();
  document.querySelectorAll('.vf-cfg-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-cfg-tab') === tabName);
  });
  document.querySelectorAll('.vf-cfg-panel').forEach((p) => p.classList.add('hidden'));
  document.getElementById(`vf-cfg-panel-${tabName}`)?.classList.remove('hidden');
}

function renderKbDocsList() {
  const listEl = document.getElementById('vf-kb-docs-list');
  const titleEl = document.getElementById('vf-kb-doc-title');
  const contentEl = document.getElementById('vf-kb-doc-content');
  if (!listEl) return;

  listEl.innerHTML = '';
  if (vfState.knowledgeDocs.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-slate-500 py-2">Nenhum documento Markdown cadastrado.</p>';
    vfState.activeKbDocId = null;
    if (titleEl && contentEl) {
      titleEl.value = '';
      contentEl.value = '';
    }
    cancelDeleteKnowledgeDoc();
    refreshIcons();
    return;
  }

  if (!vfState.activeKbDocId || !vfState.knowledgeDocs.some((d) => d.id === vfState.activeKbDocId)) {
    vfState.activeKbDocId = vfState.knowledgeDocs[0].id;
  }

  vfState.knowledgeDocs.forEach((doc) => {
    const isActive = doc.id === vfState.activeKbDocId;
    const row = document.createElement('div');
    row.className = `flex items-center gap-1 rounded-xl border transition-colors ${
      isActive
        ? 'bg-blue-600/20 border-blue-400/50 text-white'
        : 'bg-[#070B14]/70 border-sky-400/15 text-slate-300 hover:border-blue-400/40'
    }`;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'flex-1 min-w-0 text-left px-3 py-2 text-xs font-medium truncate';
    selectBtn.textContent = doc.title;
    selectBtn.addEventListener('click', () => {
      vfState.activeKbDocId = doc.id;
      cancelDeleteKnowledgeDoc();
      renderKbDocsList();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.title = 'Excluir documento';
    delBtn.setAttribute('aria-label', `Excluir ${doc.title}`);
    delBtn.className =
      'shrink-0 mr-1 p-1.5 rounded-lg text-rose-400/75 hover:text-rose-300 hover:bg-rose-500/15 transition-colors';
    delBtn.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      promptDeleteKnowledgeDoc(doc.id);
    });

    row.appendChild(selectBtn);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });

  const activeDoc = vfState.knowledgeDocs.find((d) => d.id === vfState.activeKbDocId);
  if (activeDoc && titleEl && contentEl) {
    titleEl.value = activeDoc.title;
    contentEl.value = activeDoc.content;
  }
  refreshIcons();
}

async function readFilePartsForGemini(file, promptText) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return [{ inlineData: { mimeType: 'application/pdf', data: base64 } }, { text: promptText }];
  }
  const rawText = await file.text();
  return [{ text: `${promptText}\n\nConteúdo do arquivo:\n"""\n${rawText}\n"""` }];
}

async function extractScriptFromFileWithGemini(file, personaName) {
  const prompt = `Você é um especialista em prospecção B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Extraia e estruture o roteiro de ligação comercial do arquivo enviado para a persona "${personaName}".

REGRAS OBRIGATÓRIAS:
1. Insira automaticamente as variáveis dinâmicas {nome}, {decisor}, {empresa}, {vertical}, {case_1} e {case_2} nos trechos adequados (nunca insira tags de data ou hora).
2. Escreva 100% SEM ABREVIAÇÕES (nunca use "min", "att", "vc", "pq", "obs", "Dr.", "Dra." — escreva "minutos", "atenciosamente", "você", "doutor", "doutora").
3. Retorne EXCLUSIVAMENTE um JSON válido neste formato, separando APENAS o que o vendedor deve ler em voz alta (sem rótulos como "Se respondeu SIM" dentro de fala_principal/fala):
{
  "passos": [
    {
      "passo": 1,
      "titulo": "Nome curto da etapa",
      "fala_principal": "APENAS o texto exato para falar em voz alta no passo",
      "acao_sim": { "tipo": "avancar ou falar", "proximo_passo": 2, "fala": "vazio se avancar, ou APENAS a fala positiva se falar" },
      "acao_nao": { "tipo": "falar ou encerrar", "proximo_passo": null, "fala": "APENAS a fala de contorno para ler em voz alta (ou vazio)" }
    }
  ]
}`;

  const parts = await readFilePartsForGemini(file, prompt);
  const { text } = await callGemini({ parts, useGoogleSearch: false });
  const tree = convertScriptToDecisionTree(text, personaName);
  if (tree.length > 0) {
    return serializeDecisionTreeToText(tree);
  }
  return text.replace(/```[\s\S]*?\n|```/g, '').trim();
}

async function formatScriptTextWithGemini(rawText, personaName) {
  const prompt = `Você é um especialista em prospecção B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Converta e estruture o roteiro bruto abaixo para a persona "${personaName}" em uma árvore de decisão limpa.

REGRAS OBRIGATÓRIAS:
1. Encaixe automaticamente as variáveis dinâmicas {nome}, {decisor}, {empresa}, {vertical}, {case_1} e {case_2} nos pontos adequados (nunca insira tags de data ou hora).
2. Escreva 100% SEM ABREVIAÇÕES (nunca use "min", "att", "vc", "pq", "obs", "Dr.", "Dra." — escreva por extenso).
3. Separe rigorosamente:
   - "fala_principal": APENAS o texto exato que o vendedor deve ler em voz alta no passo atual (SEM instruções como "Se respondeu SIM", "Se respondeu NÃO" ou "Avance para o Passo 2").
   - "acao_sim": { "tipo": "avancar" | "falar" | "concluir", "proximo_passo": number | null, "fala": "APENAS a fala positiva se tipo === falar, caso contrário vazio" }.
   - "acao_nao": { "tipo": "falar" | "encerrar", "proximo_passo": null, "fala": "APENAS a fala de contorno para ler em voz alta, sem rótulos de instrução" }.
4. Retorne EXCLUSIVAMENTE um JSON válido:
{
  "passos": [
    {
      "passo": 1,
      "titulo": "Nome curto da etapa",
      "fala_principal": "Texto falado em voz alta",
      "acao_sim": { "tipo": "avancar", "proximo_passo": 2, "fala": "" },
      "acao_nao": { "tipo": "falar", "proximo_passo": null, "fala": "Texto de contorno falado em voz alta" }
    }
  ]
}

Texto bruto colado:
"""
${rawText}
"""`;

  const { text } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: false,
  });
  const tree = convertScriptToDecisionTree(text, personaName);
  if (tree.length > 0) {
    return serializeDecisionTreeToText(tree);
  }
  return text.replace(/```[\s\S]*?\n|```/g, '').trim();
}

async function extractEmailFromFileWithGemini(file, stageLabel) {
  const prompt = `Você é um especialista em copywriting comercial B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Processe o documento enviado para gerar o modelo de "${stageLabel}".

REGRAS OBRIGATÓRIAS:
1. Separe automaticamente o "assunto" e o "corpo" do e-mail.
2. Aplique automaticamente as variáveis dinâmicas {nome}, {empresa}, {vertical}, {case_1} e {case_2} nos pontos adequados (e {assinatura} no fechamento se houver assinatura, ou encerre pronto para assinatura). Nunca insira tags de data ou hora.
3. Remova qualquer abreviação do texto (nunca use "min", "att", "vc", "pq", "obs", "Dr.", "Dra." — escreva por extenso).
4. Retorne EXCLUSIVAMENTE um JSON válido neste formato:
{
  "assunto": "string",
  "corpo": "string com quebras de linha normais"
}`;

  const parts = await readFilePartsForGemini(file, prompt);
  const { text } = await callGemini({ parts, useGoogleSearch: false });
  const parsed = parseJsonFromGeminiText(text);
  return {
    assunto: String(parsed.assunto || '').trim(),
    corpo: String(parsed.corpo || '').trim(),
  };
}

async function formatEmailTextWithGemini(rawText, currentSubject, stageLabel) {
  const prompt = `Você é um especialista em copywriting comercial B2B da ${vfState.activeProject?.name || 'Benner Jurídico'}.
Formate o texto bruto abaixo para o modelo "${stageLabel}".

Assunto informado (use ou melhore aplicando variáveis se necessário): "${currentSubject || ''}"

REGRAS OBRIGATÓRIAS:
1. Separe/refine o "assunto" e o "corpo" do e-mail.
2. Aplique automaticamente as variáveis dinâmicas {nome}, {empresa}, {vertical}, {case_1} e {case_2} nos pontos adequados (e {assinatura} no fechamento se houver assinatura). Nunca insira tags de data ou hora.
3. Remova qualquer abreviação do texto (nunca use "min", "att", "vc", "pq", "obs", "Dr.", "Dra." — escreva por extenso).
4. Retorne EXCLUSIVAMENTE um JSON válido neste formato:
{
  "assunto": "string",
  "corpo": "string com quebras de linha normais"
}

Texto bruto colado:
"""
${rawText}
"""`;

  const { text } = await callGemini({
    parts: [{ text: prompt }],
    useGoogleSearch: false,
  });
  const parsed = parseJsonFromGeminiText(text);
  return {
    assunto: String(parsed.assunto || currentSubject || '').trim(),
    corpo: String(parsed.corpo || rawText || '').trim(),
  };
}

function getEmailStageMeta(stageNum) {
  const num = Number(stageNum);
  if (num === 2) {
    return {
      idx: 2,
      label: 'E-mail 2 — Follow-up',
      subjKey: 'email2Subject',
      bodyKey: 'email2Body',
    };
  }
  if (num === 3) {
    return {
      idx: 3,
      label: 'E-mail 3 — Blackout / Encerramento',
      subjKey: 'email3Subject',
      bodyKey: 'email3Body',
    };
  }
  return {
    idx: 1,
    label: 'E-mail 1 — Primeiro Contato',
    subjKey: 'email1Subject',
    bodyKey: 'email1Body',
  };
}

function renderScriptsEditorList() {
  const container = document.getElementById('vf-scripts-list');
  if (!container) return;

  container.innerHTML = '';
  if (!Array.isArray(vfState.scripts) || vfState.scripts.length === 0) {
    container.innerHTML =
      '<div class="rounded-xl bg-[#070B14]/60 border border-sky-400/15 px-4 py-5 text-center text-xs text-slate-400">Nenhum script cadastrado. Clique em <strong>+ Novo Script</strong> para adicionar.</div>';
    refreshIcons();
    return;
  }

  vfState.scripts.forEach((scriptItem) => {
    const card = document.createElement('div');
    card.setAttribute('data-script-card', scriptItem.id);
    card.className = 'rounded-2xl bg-[#070B14]/65 border border-sky-400/15 p-4 space-y-2.5';

    const previewText = (scriptItem.content || '').trim();
    card.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="px-2.5 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-400/25 text-[11px] font-semibold uppercase tracking-wider text-cyan-300 shrink-0">
            Persona
          </span>
          <span class="text-xs sm:text-sm font-semibold text-[#F8FAFC] truncate">
            ${escapeHtml(scriptItem.name || 'Sem nome')}
          </span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-script-edit
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 border border-blue-400/35 text-[11px] font-medium text-blue-200 transition-all"
          >
            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            <span>Editar / Substituir</span>
          </button>
          <button
            type="button"
            data-script-delete
            title="Excluir script"
            aria-label="Excluir script ${escapeHtml(scriptItem.name || '')}"
            class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 border border-rose-400/25 text-[11px] font-medium text-rose-300 transition-colors"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            <span>Excluir</span>
          </button>
        </div>
      </div>
      <div class="rounded-xl bg-[#0B1221]/80 border border-sky-400/10 p-3">
        <p class="text-xs ${previewText ? 'text-slate-300' : 'text-slate-500 italic'} whitespace-pre-line line-clamp-3 leading-relaxed">${
          previewText ? escapeHtml(previewText) : 'Roteiro vazio — clique em Editar / Substituir para colar o texto ou importar um arquivo.'
        }</p>
      </div>
    `;

    card.querySelector('[data-script-edit]')?.addEventListener('click', () => {
      openUnifiedTemplateModal('edit-script', { scriptId: scriptItem.id });
    });

    card.querySelector('[data-script-delete]')?.addEventListener('click', async () => {
      vfState.scripts = vfState.scripts.filter((s) => s.id !== scriptItem.id);
      if (vfState.activeScriptId === scriptItem.id) {
        vfState.activeScriptId = vfState.scripts[0]?.id || null;
        resetScriptFlow(false);
      }
      syncTemplateTelepromptersFromScripts();
      saveTemplatesLocal();
      await syncScriptsToSupabase();
      renderScriptsEditorList();
      renderScriptInteractive(getActiveAccount());
      showToast(`Script "${scriptItem.name || 'sem nome'}" removido.`);
    });

    container.appendChild(card);
  });

  refreshIcons();
}

function populateEmailAndSignatureEditors() {
  [1, 2, 3].forEach((idx) => {
    const meta = getEmailStageMeta(idx);
    const subPreview = document.getElementById(`vf-email${idx}-subject-preview`);
    const bodyPreview = document.getElementById(`vf-email${idx}-body-preview`);
    const subVal = (vfState.templates[meta.subjKey] || '').trim();
    const bodyVal = (vfState.templates[meta.bodyKey] || '').trim();
    if (subPreview) subPreview.textContent = subVal || 'Sem assunto definido';
    if (bodyPreview) {
      bodyPreview.textContent =
        bodyVal || 'Corpo vazio — clique em Editar / Substituir para colar o modelo ou importar um arquivo.';
    }
  });
  const sigScripts = document.getElementById('vf-cfg-scripts-signature');
  if (sigScripts) sigScripts.value = vfState.projectConfig.signature || '';
}

function setModalTemplateStatus(message = '', type = 'info') {
  const el = document.getElementById('vf-modal-tpl-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden', 'text-cyan-300', 'text-rose-300', 'text-emerald-300');
  if (type === 'error') el.classList.add('text-rose-300');
  else if (type === 'success') el.classList.add('text-emerald-300');
  else el.classList.add('text-cyan-300');
}

function closeUnifiedTemplateModal() {
  document.getElementById('vf-template-editor-modal')?.classList.add('hidden');
  templateModalState.mode = null;
  templateModalState.scriptId = null;
  templateModalState.emailStage = null;
  setModalTemplateStatus('');
}

function openUnifiedTemplateModal(mode, options = {}) {
  const modal = document.getElementById('vf-template-editor-modal');
  const headingEl = document.getElementById('vf-modal-tpl-heading');
  const titleLabelEl = document.getElementById('vf-modal-tpl-title-label');
  const titleInput = document.getElementById('vf-modal-tpl-title');
  const bodyInput = document.getElementById('vf-modal-tpl-body');
  const sigPill = document.getElementById('vf-modal-tpl-sig-pill');
  const saveBtn = document.getElementById('vf-modal-tpl-save-btn');
  if (!modal || !titleInput || !bodyInput) return;

  templateModalState.mode = mode;
  templateModalState.scriptId = options.scriptId || null;
  templateModalState.emailStage = options.emailStage || null;
  setModalTemplateStatus('');

  if (mode === 'new-script') {
    if (headingEl) headingEl.textContent = 'Novo Script de Abordagem';
    if (titleLabelEl) titleLabelEl.textContent = 'Título / Persona do Script';
    titleInput.placeholder = 'Ex: Jurídico, Financeiro, Diretoria...';
    titleInput.value = '';
    bodyInput.placeholder = 'Cole o texto bruto ou escreva o roteiro usando {nome}, {empresa}, {vertical}, {case_1}, {case_2}...';
    bodyInput.value = '';
    sigPill?.classList.add('hidden');
    if (saveBtn) saveBtn.textContent = 'Criar Script';
  } else if (mode === 'edit-script') {
    const item = vfState.scripts.find((s) => s.id === options.scriptId);
    if (!item) return;
    if (headingEl) headingEl.textContent = `Editar / Substituir Script — ${item.name || 'Persona'}`;
    if (titleLabelEl) titleLabelEl.textContent = 'Título / Persona do Script';
    titleInput.placeholder = 'Ex: Jurídico, Financeiro, Diretoria...';
    titleInput.value = item.name || '';
    bodyInput.placeholder = 'Cole o texto bruto ou edite o roteiro usando {nome}, {empresa}, {vertical}, {case_1}, {case_2}...';
    bodyInput.value = item.content || '';
    sigPill?.classList.add('hidden');
    if (saveBtn) saveBtn.textContent = 'Salvar Script';
  } else if (mode === 'edit-email') {
    const meta = getEmailStageMeta(options.emailStage);
    if (headingEl) headingEl.textContent = `Editar / Substituir ${meta.label}`;
    if (titleLabelEl) titleLabelEl.textContent = 'Assunto do E-mail';
    titleInput.placeholder = `Assunto do ${meta.label}...`;
    titleInput.value = vfState.templates[meta.subjKey] || '';
    bodyInput.placeholder = 'Cole o texto bruto ou escreva o corpo do e-mail usando {nome}, {empresa}, {vertical}, {case_1}, {case_2} e {assinatura}...';
    bodyInput.value = vfState.templates[meta.bodyKey] || '';
    sigPill?.classList.remove('hidden');
    if (saveBtn) saveBtn.textContent = 'Salvar E-mail';
  }

  modal.classList.remove('hidden');
  refreshIcons();
  setTimeout(() => titleInput.focus(), 50);
}

async function handleModalTemplateFileImport(file) {
  if (!file) return;
  const uploadLabel = document.getElementById('vf-modal-tpl-upload-label');
  const titleInput = document.getElementById('vf-modal-tpl-title');
  const bodyInput = document.getElementById('vf-modal-tpl-body');
  if (uploadLabel) uploadLabel.textContent = 'Processando IA...';
  setModalTemplateStatus(`Lendo "${file.name}" com Gemini 2.5 Flash e aplicando variáveis...`, 'info');

  try {
    if (templateModalState.mode === 'edit-email') {
      const meta = getEmailStageMeta(templateModalState.emailStage);
      const result = await extractEmailFromFileWithGemini(file, meta.label);
      if (titleInput) titleInput.value = result.assunto;
      if (bodyInput) bodyInput.value = result.corpo;
      setModalTemplateStatus(`"${file.name}" processado! Revise os campos acima e clique em Salvar.`, 'success');
    } else {
      const persona = (titleInput?.value || '').trim() || 'Executivo';
      const extracted = await extractScriptFromFileWithGemini(file, persona);
      if (bodyInput) bodyInput.value = extracted;
      if (titleInput && !titleInput.value.trim()) {
        titleInput.value = file.name.replace(/\.(pdf|md|txt)$/i, '');
      }
      setModalTemplateStatus(`Roteiro extraído de "${file.name}"! Revise e clique em Salvar.`, 'success');
    }
  } catch (err) {
    setModalTemplateStatus(`Erro ao importar arquivo: ${err.message}`, 'error');
  } finally {
    if (uploadLabel) uploadLabel.textContent = 'Importar de Arquivo (.pdf, .md, .txt)';
  }
}

async function handleModalTemplateAiFormat() {
  const titleInput = document.getElementById('vf-modal-tpl-title');
  const bodyInput = document.getElementById('vf-modal-tpl-body');
  const btn = document.getElementById('vf-modal-tpl-ai-format-btn');
  const btnLabel = document.getElementById('vf-modal-tpl-ai-format-label');
  const rawBody = (bodyInput?.value || '').trim();
  const rawTitle = (titleInput?.value || '').trim();

  if (!rawBody) {
    setModalTemplateStatus('Cole ou digite um texto na área acima antes de formatar com IA.', 'error');
    bodyInput?.focus();
    return;
  }

  if (btn) btn.disabled = true;
  if (btnLabel) btnLabel.textContent = 'Formatando com IA...';
  setModalTemplateStatus('Aplicando variáveis ({nome}, {empresa}, {vertical}, {case_1}, {case_2}) e removendo abreviações...', 'info');

  try {
    if (templateModalState.mode === 'edit-email') {
      const meta = getEmailStageMeta(templateModalState.emailStage);
      const formatted = await formatEmailTextWithGemini(rawBody, rawTitle, meta.label);
      if (titleInput && formatted.assunto) titleInput.value = formatted.assunto;
      if (bodyInput) bodyInput.value = formatted.corpo;
    } else {
      const persona = rawTitle || 'Executivo';
      const formatted = await formatScriptTextWithGemini(rawBody, persona);
      if (bodyInput) bodyInput.value = formatted;
    }
    setModalTemplateStatus('Texto formatado com variáveis e sem abreviações! Revise e clique em Salvar.', 'success');
  } catch (err) {
    setModalTemplateStatus(`Erro ao formatar com IA: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnLabel) btnLabel.textContent = 'Formatar & Aplicar Variáveis com IA';
  }
}

async function handleModalTemplateSave() {
  const titleInput = document.getElementById('vf-modal-tpl-title');
  const bodyInput = document.getElementById('vf-modal-tpl-body');
  const titleVal = (titleInput?.value || '').trim();
  const bodyVal = bodyInput?.value || '';

  if (templateModalState.mode === 'new-script') {
    if (!titleVal) {
      setModalTemplateStatus('Informe o Título / Persona do script antes de salvar.', 'error');
      titleInput?.focus();
      return;
    }
    const decisionTree = convertScriptToDecisionTree(bodyVal, titleVal);
    const newItem = {
      id: `script-${Date.now()}`,
      name: titleVal,
      content: bodyVal,
      decisionTree,
    };
    vfState.scripts.push(newItem);
    if (vfState.scripts.length === 1 || !vfState.activeScriptId) {
      vfState.activeScriptId = newItem.id;
      resetScriptFlow(false);
    }
    syncTemplateTelepromptersFromScripts();
    saveTemplatesLocal();
    await syncScriptsToSupabase();
    await upsertKnowledgeDocInSupabase('templates', 'templates', vfState.templates);
    renderScriptsEditorList();
    renderScriptInteractive(getActiveAccount());
    closeUnifiedTemplateModal();
    showToast(`Script "${titleVal}" criado e salvo!`);
    return;
  }

  if (templateModalState.mode === 'edit-script') {
    if (!titleVal) {
      setModalTemplateStatus('Informe o Título / Persona do script antes de salvar.', 'error');
      titleInput?.focus();
      return;
    }
    const decisionTree = convertScriptToDecisionTree(bodyVal, titleVal);
    const target = vfState.scripts.find((s) => s.id === templateModalState.scriptId);
    if (target) {
      target.name = titleVal;
      target.content = bodyVal;
      target.decisionTree = decisionTree;
    }
    syncTemplateTelepromptersFromScripts();
    saveTemplatesLocal();
    await syncScriptsToSupabase();
    await upsertKnowledgeDocInSupabase('templates', 'templates', vfState.templates);
    renderScriptsEditorList();
    resetScriptFlow(false);
    renderScriptInteractive(getActiveAccount());
    closeUnifiedTemplateModal();
    showToast(`Script "${titleVal}" atualizado!`);
    return;
  }

  if (templateModalState.mode === 'edit-email') {
    const meta = getEmailStageMeta(templateModalState.emailStage);
    vfState.templates[meta.subjKey] = titleVal;
    vfState.templates[meta.bodyKey] = bodyVal;
    saveTemplatesLocal();
    await upsertKnowledgeDocInSupabase('templates', 'templates', vfState.templates);
    populateEmailAndSignatureEditors();
    if (vfState.stage === 'cockpit') renderOutputCards(getActiveAccount());
    closeUnifiedTemplateModal();
    showToast(`${meta.label} salvo!`);
  }
}

function openProjectConfigModal(initialTab = 'metas') {
  if (!isAdminRoot()) {
    showToast('Acesso restrito ao administrador para editar Script Template.');
    return;
  }
  const modal = document.getElementById('project-config-modal');
  if (!modal) return;

  const targetTab = typeof initialTab === 'string' && initialTab ? initialTab : 'metas';

  document.getElementById('vf-cfg-project-title').textContent = vfState.activeProject?.name || 'Projeto';

  const { dailyTarget, newTarget, followupTarget, maxAttempts } = getProjectLimits();
  document.getElementById('vf-cfg-daily-target').value = dailyTarget;
  document.getElementById('vf-cfg-new-target').value = newTarget;
  document.getElementById('vf-cfg-max-attempts').value = maxAttempts;
  document.getElementById('vf-cfg-followup-preview').textContent =
    `Meta / Teto diário de Follow-ups calculado: ${followupTarget}/dia.`;

  cancelDeleteKnowledgeDoc();
  renderKbDocsList();

  renderScriptsEditorList();
  populateEmailAndSignatureEditors();

  document.getElementById('vf-cfg-bitrix-signature').value = vfState.projectConfig.signature || '';
  document.getElementById('vf-cfg-bitrix-template').value = vfState.projectConfig.bitrixActivityTemplate || '';

  const brainPromptEl = document.getElementById('vf-cfg-brain-prompt');
  if (brainPromptEl) brainPromptEl.value = vfState.playbookRules || '';

  switchConfigTab(targetTab);
  modal.classList.remove('hidden');
  refreshIcons();
}

async function handleKbFileUpload(file) {
  if (!file) return;
  const uploadLabel = document.getElementById('vf-kb-upload-label');
  if (uploadLabel) uploadLabel.textContent = 'Convertendo...';

  try {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    let markdownText = '';

    if (isPdf) {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { text } = await callGemini({
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64 } },
          { text: 'Converta todo o conteúdo relevante deste PDF em Markdown limpo, bem estruturado com títulos (#, ##) e listas.' },
        ],
      });
      markdownText = text;
    } else {
      const raw = await file.text();
      if (!file.name.toLowerCase().endsWith('.md')) {
        const { text } = await callGemini({
          parts: [
            { text: `Organize o texto abaixo em Markdown comercial limpo e estruturado:\n\n${raw}` },
          ],
        });
        markdownText = text || raw;
      } else {
        markdownText = raw;
      }
    }

    const cleanTitle = file.name.replace(/\.(pdf|txt)$/i, '.md');
    const newDoc = {
      id: `doc-${Date.now()}`,
      title: cleanTitle,
      content: markdownText,
    };
    const dbId = await upsertKnowledgeDocInSupabase('markdown', newDoc.title, newDoc.content);
    if (dbId) newDoc.id = dbId;

    vfState.knowledgeDocs.push(newDoc);
    vfState.activeKbDocId = newDoc.id;
    saveKnowledgeLocal();
    renderKbDocsList();
    showToast(`"${newDoc.title}" convertido e salvo em vf_knowledge_docs!`);
  } catch (err) {
    showToast(`Erro ao processar arquivo: ${err.message}`);
  } finally {
    if (uploadLabel) uploadLabel.textContent = 'Upload PDF / TXT / MD';
  }
}

// ==========================================================================
// Project Selection & Stage Transitions
// ==========================================================================
async function selectProject(project, targetStage = null) {
  vfState.activeProject = project;
  localStorage.setItem(VF_STORAGE.ACTIVE_PROJECT_ID, project.id);

  loadLocalProjectState();
  await loadProjectDataFromSupabase(project);

  renderTopbarControls();
  renderScoreboard();

  if (targetStage) {
    if (targetStage === 'intake') {
      returnToCleanIntake();
    } else {
      setStage(targetStage);
    }
  }
}

async function openProjectIntoIntake(project) {
  await selectProject(project, 'intake');
}

// ==========================================================================
// Event Bindings
// ==========================================================================
function bindEvents() {
  // Stage 2 & 3 -> Back to Stage 1 (Project Selector)
  document.getElementById('vf-back-to-projects-btn')?.addEventListener('click', () => {
    vfState.activeAccountId = null;
    renderProjectsSelectorGrid();
    setStage('projects');
  });

  // Stage 3 -> Return cleanly to Stage 2 (Company Intake)
  document.getElementById('vf-cockpit-next-top-btn')?.addEventListener('click', returnToCleanIntake);
  document.getElementById('vf-cockpit-next-bottom-btn')?.addEventListener('click', returnToCleanIntake);

  // Admin Root: Configurar Projeto
  document.getElementById('vf-open-project-config-btn')?.addEventListener('click', openProjectConfigModal);

  // Cockpit Workspace 4 Tabs
  document.querySelectorAll('.vf-cockpit-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchCockpitTab(btn.getAttribute('data-cockpit-tab'));
    });
  });

  // Interactive Script Decision Tree controls (SIM / NÃO / Voltar / Reiniciar / Concluir / Empty State)
  document.getElementById('vf-script-empty-open-cfg-btn')?.addEventListener('click', () => openProjectConfigModal('scripts'));
  document.getElementById('vf-script-yes-btn')?.addEventListener('click', () => advanceScriptDecision('yes'));
  document.getElementById('vf-script-no-btn')?.addEventListener('click', () => advanceScriptDecision('no'));
  document.getElementById('vf-script-back-btn')?.addEventListener('click', stepBackScriptDecision);
  document.getElementById('vf-script-reset-btn')?.addEventListener('click', () => resetScriptFlow(true));
  document.getElementById('vf-script-finish-btn')?.addEventListener('click', finishScriptFlowToRegistro);

  // Discard by ICP, Rescue discarded lead & Reanalyze with AI Brain
  document.getElementById('vf-discard-icp-btn')?.addEventListener('click', handleDiscardByIcp);
  document.getElementById('vf-rescue-lead-btn')?.addEventListener('click', handleRescueLead);
  document.getElementById('vf-reanalyze-brain-btn')?.addEventListener('click', handleReanalyzeWithBrain);

  // 4 Quick 1-click chips
  document.querySelectorAll('.vf-quick-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-quick-chip');
      if (!val) return;
      if (vfState.selectedChips.has(val)) {
        vfState.selectedChips.delete(val);
        chip.classList.remove('active');
      } else {
        vfState.selectedChips.add(val);
        chip.classList.add('active');
      }
    });
  });

  // Voice mic
  document.getElementById('vf-voice-btn')?.addEventListener('click', toggleVoiceRecognition);

  // Process & Register Attempt
  document.getElementById('vf-process-attempt-btn')?.addEventListener('click', handleProcessAndRegisterAttempt);

  // Tab 3 & Tab 4 Copy + Contextual WhatsApp Modal buttons
  document.getElementById('vf-copy-bitrix-btn')?.addEventListener('click', () => {
    const label = document.getElementById('vf-copy-bitrix-label');
    copyText(
      vfState.lastBitrixText || document.getElementById('vf-output-bitrix')?.textContent || '',
      label,
      'Copiar Atualização do CRM'
    );
  });

  document.getElementById('vf-bitrix-to-email-btn')?.addEventListener('click', () => {
    switchCockpitTab('email');
  });

  document.getElementById('vf-copy-subject-btn')?.addEventListener('click', () => {
    const label = document.getElementById('vf-copy-subject-label');
    const subj = vfState.lastMessageSubject || document.getElementById('vf-output-subject')?.textContent || '';
    copyText(subj, label, 'Copiar Assunto');
  });

  document.getElementById('vf-copy-message-btn')?.addEventListener('click', () => {
    const label = document.getElementById('vf-copy-message-label');
    const text = vfState.lastMessageBody || document.getElementById('vf-output-message')?.textContent || '';
    copyText(text, label, 'Copiar E-mail');
  });

  document.getElementById('vf-open-wa-modal-btn')?.addEventListener('click', openWhatsappContextModal);
  document.getElementById('vf-copy-whatsapp-btn')?.addEventListener('click', () => {
    const label = document.getElementById('vf-copy-whatsapp-label');
    if (!vfState.lastWhatsappText) {
      showToast('Gere uma mensagem de WhatsApp contextual primeiro.');
      return;
    }
    copyText(vfState.lastWhatsappText, label, 'Copiar WhatsApp');
  });
  document.getElementById('vf-wa-modal-close-btn')?.addEventListener('click', closeWhatsappContextModal);
  document.getElementById('vf-wa-modal-cancel-btn')?.addEventListener('click', closeWhatsappContextModal);
  document.getElementById('vf-wa-context-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'vf-wa-context-modal') {
      closeWhatsappContextModal();
    }
  });
  document.getElementById('vf-wa-voice-btn')?.addEventListener('click', toggleWhatsappVoiceRecognition);
  document.getElementById('vf-wa-generate-btn')?.addEventListener('click', handleGenerateContextualWhatsapp);

  // Project Config Modal
  document.getElementById('vf-close-project-config-modal')?.addEventListener('click', () => {
    document.getElementById('project-config-modal')?.classList.add('hidden');
  });
  document.getElementById('project-config-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'project-config-modal') {
      document.getElementById('project-config-modal')?.classList.add('hidden');
    }
  });
  document.querySelectorAll('.vf-cfg-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchConfigTab(btn.getAttribute('data-cfg-tab')));
  });

  // Tab 1: Metas & Cadência
  const updateFollowPreview = () => {
    const d = Number(document.getElementById('vf-cfg-daily-target')?.value || 25);
    const n = Number(document.getElementById('vf-cfg-new-target')?.value || 7);
    const el = document.getElementById('vf-cfg-followup-preview');
    if (el) el.textContent = `Meta / Teto diário de Follow-ups calculado: ${Math.max(1, d - n)}/dia.`;
  };
  document.getElementById('vf-cfg-daily-target')?.addEventListener('input', updateFollowPreview);
  document.getElementById('vf-cfg-new-target')?.addEventListener('input', updateFollowPreview);

  document.getElementById('vf-cfg-panel-metas')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dailyTarget = Math.max(1, Number(document.getElementById('vf-cfg-daily-target').value || 25));
    const newTarget = Math.max(0, Number(document.getElementById('vf-cfg-new-target').value || 7));
    const maxAttempts = Math.max(1, Number(document.getElementById('vf-cfg-max-attempts').value || 3));
    const followupTarget = Math.max(1, dailyTarget - newTarget);

    vfState.projectConfig.dailyTarget = dailyTarget;
    vfState.projectConfig.newTarget = newTarget;
    vfState.projectConfig.followupTarget = followupTarget;
    vfState.projectConfig.maxAttempts = maxAttempts;
    if (vfState.activeProject) {
      vfState.activeProject.dailyTarget = dailyTarget;
      vfState.activeProject.newTarget = newTarget;
      vfState.activeProject.followupTarget = followupTarget;
      vfState.activeProject.maxAttempts = maxAttempts;
      const inList = vfState.projects.find((p) => p.id === vfState.activeProject.id);
      if (inList && inList !== vfState.activeProject) {
        inList.dailyTarget = dailyTarget;
        inList.newTarget = newTarget;
        inList.followupTarget = followupTarget;
        inList.maxAttempts = maxAttempts;
      }
    }
    saveConfigLocal();
    localStorage.setItem(VF_STORAGE.PROJECTS, JSON.stringify(vfState.projects));
    await syncProjectGoalsToSupabase();
    renderProjectsSelectorGrid();
    renderScoreboard();
    if (vfState.stage === 'cockpit') renderDossierAndScript();
    showToast('Metas e cadência atualizadas!');
  });

  // Tab 2: Base de Conhecimento Markdown
  document.getElementById('vf-kb-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleKbFileUpload(file);
    e.target.value = '';
  });
  document.getElementById('vf-kb-new-btn')?.addEventListener('click', () => {
    vfState.activeKbDocId = null;
    document.getElementById('vf-kb-doc-title').value = '';
    document.getElementById('vf-kb-doc-content').value = '';
    document.getElementById('vf-kb-doc-title').focus();
  });
  document.getElementById('vf-kb-save-btn')?.addEventListener('click', async () => {
    const title = document.getElementById('vf-kb-doc-title').value.trim() || `doc-${Date.now()}.md`;
    const content = document.getElementById('vf-kb-doc-content').value;
    if (!content.trim()) {
      showToast('Escreva o conteúdo em Markdown antes de salvar.');
      return;
    }

    const existing = vfState.knowledgeDocs.find((d) => d.id === vfState.activeKbDocId);
    const dbId = await upsertKnowledgeDocInSupabase('markdown', title, content, existing?.id || null);

    if (existing) {
      existing.title = title;
      existing.content = content;
      if (dbId) existing.id = dbId;
    } else {
      const created = { id: dbId || `doc-${Date.now()}`, title, content };
      vfState.knowledgeDocs.push(created);
      vfState.activeKbDocId = created.id;
    }
    saveKnowledgeLocal();
    renderKbDocsList();
    showToast('Documento Markdown salvo em vf_knowledge_docs!');
  });
  document.getElementById('vf-kb-delete-btn')?.addEventListener('click', () => {
    if (!vfState.activeKbDocId) return;
    promptDeleteKnowledgeDoc(vfState.activeKbDocId);
  });
  document.getElementById('vf-kb-delete-cancel-btn')?.addEventListener('click', cancelDeleteKnowledgeDoc);
  document.getElementById('vf-kb-delete-confirm-btn')?.addEventListener('click', () => {
    if (pendingDeleteKbDocId) executeDeleteKnowledgeDoc(pendingDeleteKbDocId);
  });

  // Tab 3: Scripts & Templates (Modal Unificado + Assinatura Oficial)
  document.getElementById('vf-add-script-btn')?.addEventListener('click', () => {
    openUnifiedTemplateModal('new-script');
  });

  [1, 2, 3].forEach((idx) => {
    document.getElementById(`vf-email${idx}-edit-btn`)?.addEventListener('click', () => {
      openUnifiedTemplateModal('edit-email', { emailStage: idx });
    });
  });

  // Modal Unificado: Scripts & E-mails
  document.getElementById('vf-modal-tpl-close-btn')?.addEventListener('click', closeUnifiedTemplateModal);
  document.getElementById('vf-modal-tpl-cancel-btn')?.addEventListener('click', closeUnifiedTemplateModal);
  document.getElementById('vf-template-editor-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'vf-template-editor-modal') {
      closeUnifiedTemplateModal();
    }
  });
  document.getElementById('vf-modal-tpl-clear-btn')?.addEventListener('click', () => {
    const titleEl = document.getElementById('vf-modal-tpl-title');
    const bodyEl = document.getElementById('vf-modal-tpl-body');
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    setModalTemplateStatus('');
    titleEl?.focus();
  });
  document.getElementById('vf-modal-tpl-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleModalTemplateFileImport(file);
  });
  document.getElementById('vf-modal-tpl-ai-format-btn')?.addEventListener('click', handleModalTemplateAiFormat);
  document.getElementById('vf-modal-tpl-save-btn')?.addEventListener('click', handleModalTemplateSave);

  document.getElementById('vf-cfg-scripts-save-btn')?.addEventListener('click', async () => {
    syncTemplateTelepromptersFromScripts();

    // Sync multiline signature
    const rawSig = (document.getElementById('vf-cfg-scripts-signature')?.value || '')
      .replace(/\r\n/g, '\n')
      .trim();
    vfState.projectConfig.signature = rawSig || DEFAULT_PROJECT_CONFIG.signature;
    const bitrixSigEl = document.getElementById('vf-cfg-bitrix-signature');
    if (bitrixSigEl) bitrixSigEl.value = vfState.projectConfig.signature;

    saveConfigLocal();
    saveTemplatesLocal();
    await syncScriptsToSupabase();
    await upsertKnowledgeDocInSupabase('templates', 'templates', vfState.templates);
    await syncProjectGoalsToSupabase();

    if (vfState.stage === 'cockpit') {
      renderDossierAndScript();
    }
    showToast('Assinatura Oficial e modelos salvos!');
  });

  document.getElementById('vf-cfg-scripts-reset-btn')?.addEventListener('click', async () => {
    vfState.templates = {
      ...vfState.templates,
      email1Subject: DEFAULT_TEMPLATES.email1Subject,
      email1Body: DEFAULT_TEMPLATES.email1Body,
      email2Subject: DEFAULT_TEMPLATES.email2Subject,
      email2Body: DEFAULT_TEMPLATES.email2Body,
      email3Subject: DEFAULT_TEMPLATES.email3Subject,
      email3Body: DEFAULT_TEMPLATES.email3Body,
    };
    vfState.projectConfig.signature = DEFAULT_PROJECT_CONFIG.signature;
    const bitrixSigEl = document.getElementById('vf-cfg-bitrix-signature');
    if (bitrixSigEl) bitrixSigEl.value = vfState.projectConfig.signature;

    populateEmailAndSignatureEditors();
    saveConfigLocal();
    saveTemplatesLocal();
    await upsertKnowledgeDocInSupabase('templates', 'templates', vfState.templates);
    await syncProjectGoalsToSupabase();
    if (vfState.stage === 'cockpit') renderOutputCards(getActiveAccount());
    showToast('Modelos de e-mail e assinatura padrão restaurados.');
  });

  // Tab 4: Padrão CRM Bitrix24
  document.getElementById('vf-cfg-panel-bitrix')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawSig = (document.getElementById('vf-cfg-bitrix-signature').value || '')
      .replace(/\r\n/g, '\n')
      .trim();
    vfState.projectConfig.signature = rawSig || DEFAULT_PROJECT_CONFIG.signature;
    const scriptsSigEl = document.getElementById('vf-cfg-scripts-signature');
    if (scriptsSigEl) scriptsSigEl.value = vfState.projectConfig.signature;
    vfState.projectConfig.bitrixActivityTemplate = document.getElementById('vf-cfg-bitrix-template').value;
    saveConfigLocal();
    await syncProjectGoalsToSupabase();
    if (vfState.stage === 'cockpit') renderOutputCards(getActiveAccount());
    showToast('Padrão Bitrix24 salvo!');
  });

  // Tab 5: Cérebro da IA (Prompt Mestre / Regras de Negócio)
  document.getElementById('vf-cfg-brain-save-btn')?.addEventListener('click', async () => {
    const promptEl = document.getElementById('vf-cfg-brain-prompt');
    vfState.playbookRules = (promptEl?.value || '').replace(/\r\n/g, '\n').trim();
    await syncPlaybookRulesToSupabase();
    showToast('Diretrizes da IA (Cérebro da IA) salvas!');
  });

  document.getElementById('vf-cfg-brain-reset-btn')?.addEventListener('click', async () => {
    const promptEl = document.getElementById('vf-cfg-brain-prompt');
    vfState.playbookRules = DEFAULT_PLAYBOOK_RULES;
    if (promptEl) promptEl.value = vfState.playbookRules;
    await syncPlaybookRulesToSupabase();
    showToast('Diretriz padrão do Cérebro da IA restaurada.');
  });

  // New Project Modal (Admin Root)
  document.getElementById('vf-close-new-project-modal')?.addEventListener('click', () => {
    document.getElementById('new-project-modal')?.classList.add('hidden');
  });
  document.getElementById('vf-cancel-new-project-modal')?.addEventListener('click', () => {
    document.getElementById('new-project-modal')?.classList.add('hidden');
  });
  document.getElementById('new-project-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'new-project-modal') {
      document.getElementById('new-project-modal')?.classList.add('hidden');
    }
  });
  document.getElementById('vf-new-project-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdminRoot()) return;
    const name = document.getElementById('vf-new-project-name').value.trim();
    const desc = document.getElementById('vf-new-project-desc').value.trim();
    if (!name) return;

    const newProject = {
      id: `proj-${Date.now()}`,
      name,
      description: desc || 'Novo funil comercial no Vitally Flow.',
      dailyTarget: 25,
      newTarget: 7,
      followupTarget: 18,
      maxAttempts: 3,
      scripts: [],
      playbookRules: '',
      isDefault: false,
    };

    if (isCloudActive()) {
      try {
        const { data, error } = await vfState.supabaseClient
          .from('vf_projects')
          .insert({
            name,
            description: newProject.description,
            user_id: vfState.user?.id || null,
            scripts: newProject.scripts,
            playbook_rules: '',
          })
          .select('*')
          .maybeSingle();
        if (!error && data?.id) {
          newProject.id = String(data.id);
        } else if (error) {
          const retry = await vfState.supabaseClient
            .from('vf_projects')
            .insert({
              name,
              description: newProject.description,
              user_id: vfState.user?.id || null,
            })
            .select('*')
            .maybeSingle();
          if (!retry.error && retry.data?.id) newProject.id = String(retry.data.id);
        }
      } catch {
        // fallback local id
      }
    }

    vfState.projects.push(newProject);
    localStorage.setItem(VF_STORAGE.PROJECTS, JSON.stringify(vfState.projects));
    document.getElementById('vf-new-project-form').reset();
    document.getElementById('new-project-modal')?.classList.add('hidden');
    renderProjectsSelectorGrid();
    showToast(`Projeto "${name}" criado!`);
  });

  // Escape closes modals (innermost popup first)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const tplModal = document.getElementById('vf-template-editor-modal');
      if (tplModal && !tplModal.classList.contains('hidden')) {
        closeUnifiedTemplateModal();
        return;
      }
      document.getElementById('project-config-modal')?.classList.add('hidden');
      document.getElementById('new-project-modal')?.classList.add('hidden');
    }
  });
}

// ==========================================================================
// Public Entrypoints
// ==========================================================================
export async function updateVitallyFlowContext(context = {}) {
  vfState.supabaseClient = context.supabaseClient || null;
  vfState.user = context.user || null;
  vfState.profile = context.profile || { role: 'admin_root', allowed_modules: ['sales', 'studio', 'apps'] };
  vfState.mode = context.mode || 'local';
  if (typeof context.geminiApiKey === 'string' && typeof window !== 'undefined') {
    window.__VITALLY_GEMINI_KEY__ = context.geminiApiKey.trim();
  }

  if (vfState.initialized) {
    await syncProjectsFromSupabase();
    if (vfState.activeProject) {
      vfState.activeProject =
        vfState.projects.find(
          (p) => p.id === vfState.activeProject.id || (vfState.activeProject.isDefault && p.isDefault)
        ) || vfState.activeProject;
    }
    renderProjectsSelectorGrid();
    renderTopbarControls();
  }
}

export async function initVitallyFlow(context = {}) {
  vfState.supabaseClient = context.supabaseClient || null;
  vfState.user = context.user || null;
  vfState.profile = context.profile || { role: 'admin_root', allowed_modules: ['sales', 'studio', 'apps'] };
  vfState.mode = context.mode || 'local';
  if (typeof context.geminiApiKey === 'string' && typeof window !== 'undefined') {
    window.__VITALLY_GEMINI_KEY__ = context.geminiApiKey.trim();
  }

  if (!vfState.initialized) {
    vfState.initialized = true;
    initIntakeForm();
    bindEvents();
  }

  // Etapa 1 obrigatória: sempre abrir no Seletor de Projetos sem nenhum lead aberto
  vfState.activeAccountId = null;
  setStage('projects');

  await syncProjectsFromSupabase();
  renderProjectsSelectorGrid();
  refreshIcons();
}
