/**
 * Grupo Vitally — Plataforma Central Executiva (Fase 1)
 * ES Module puro (Zero-build / GitHub Pages ready)
 * Gerencia autenticação (Supabase Auth ou Modo Local Offline),
 * navegação modular entre Lobby e Vertentes, e configurações locais.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initVitallyFlow, updateVitallyFlowContext } from './vitally-flow.js';

const DEFAULT_SUPABASE_URL = 'https://yyafeajyfzpvgpknaefz.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5YWZlYWp5Znpwdmdwa25hZWZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NTY5NTksImV4cCI6MjExMDUzMjk1OX0.EoX12-QqqL95JEaO24JCFdnfRCgtD0aZYueiPx7IJGA'
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  '';

const STORAGE_KEYS = {
  SUPABASE_URL: 'vitally_supabase_url',
  SUPABASE_KEY: 'vitally_supabase_key',
  GEMINI_KEY: 'vitally_flow_gemini_key',
  LOCAL_SESSION: 'vitally_local_session',
  FOLEGO_URL: 'vitally_folego_url',
};

const DEFAULT_LOCAL_USER = {
  name: 'Fábio Medeiros',
  email: 'fabio@grupovitally.com',
  mode: 'local',
};

const VALID_ROUTES = ['lobby', 'sales', 'sales-flow', 'studio', 'apps'];

const state = {
  authMode: 'signin', // 'signin' | 'signup'
  isAuthenticated: false,
  connectionMode: 'local', // 'local' | 'cloud'
  user: null,
  userProfile: { role: 'operador', allowed_modules: ['sales', 'studio', 'apps'] },
  geminiApiKey: '',
  currentRoute: 'lobby',
  supabaseClient: null,
  isSubmitting: false,
};

// ==========================================================================
// DOM Elements Cache
// ==========================================================================
const dom = {
  loginView: document.getElementById('login-view'),
  workspaceShell: document.getElementById('workspace-shell'),
  views: {
    lobby: document.getElementById('lobby-view'),
    sales: document.getElementById('sales-view'),
    'sales-flow': document.getElementById('sales-flow-view'),
    studio: document.getElementById('studio-view'),
    apps: document.getElementById('apps-view'),
  },

  // Auth Controls
  tabSignin: document.getElementById('tab-signin'),
  tabSignup: document.getElementById('tab-signup'),
  signupNameWrapper: document.getElementById('signup-name-wrapper'),
  authForm: document.getElementById('auth-form'),
  authName: document.getElementById('auth-name'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  togglePasswordBtn: document.getElementById('toggle-password-btn'),
  keepSession: document.getElementById('keep-session'),
  cloudIndicatorInline: document.getElementById('cloud-indicator-inline'),
  authFeedback: document.getElementById('auth-feedback'),
  authSubmitBtn: document.getElementById('auth-submit-btn'),
  authSubmitLabel: document.getElementById('auth-submit-label'),
  authSubmitArrow: document.getElementById('auth-submit-arrow'),
  authSubmitSpinner: document.getElementById('auth-submit-spinner'),
  localModeBtn: document.getElementById('local-mode-btn'),

  // Header Controls
  brandHomeBtn: document.getElementById('brand-home-btn'),
  userGreeting: document.getElementById('user-greeting'),
  connectionStatusBadge: document.getElementById('connection-status-badge'),
  connectionStatusIcon: document.getElementById('connection-status-icon'),
  connectionStatusText: document.getElementById('connection-status-text'),
  logoutBtn: document.getElementById('logout-btn'),

  // Login Brand Panel & Neural Canvas
  loginBrandPanel: document.getElementById('login-brand-panel'),
  loginNeuralCanvas: document.getElementById('login-neural-canvas'),

  // Supabase & API Keys Modal (Admin Root Only)
  supabaseModal: document.getElementById('supabase-modal'),
  openSupabaseHeader: document.getElementById('open-supabase-modal-header'),
  closeSupabaseModal: document.getElementById('close-supabase-modal'),
  cancelSupabaseModal: document.getElementById('cancel-supabase-modal'),
  supabaseConfigForm: document.getElementById('supabase-config-form'),
  supabaseUrlInput: document.getElementById('supabase-url-input'),
  supabaseKeyInput: document.getElementById('supabase-key-input'),
  modalGeminiKeyGroup: document.getElementById('modal-gemini-key-group'),
  modalGeminiKeyInput: document.getElementById('modal-gemini-key-input'),
  toggleModalGeminiKey: document.getElementById('toggle-modal-gemini-key'),
  supabaseModalFeedback: document.getElementById('supabase-modal-feedback'),
  clearSupabaseBtn: document.getElementById('clear-supabase-btn'),

  // Vitally Sales Expansion Modal
  newSalesModuleBtn: document.getElementById('new-sales-module-btn'),
  infoModal: document.getElementById('info-modal'),
  closeInfoModal: document.getElementById('close-info-modal'),
  confirmInfoModal: document.getElementById('confirm-info-modal'),

  // Vitally Apps — Fôlego IA
  folegoUrlForm: document.getElementById('folego-url-form'),
  folegoUrlInput: document.getElementById('folego-url-input'),
  folegoUrlFeedback: document.getElementById('folego-url-feedback'),
  folegoOpenLink: document.getElementById('folego-open-link'),
  folegoStatusPill: document.getElementById('folego-status-pill'),
};

// ==========================================================================
// Helpers & Utilities
// ==========================================================================
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function extractDisplayName(user) {
  if (!user) return 'Fábio Medeiros';
  const metaName = user.user_metadata?.full_name || user.name;
  if (metaName && typeof metaName === 'string' && metaName.trim().length > 0) {
    return metaName.trim();
  }
  if (user.email) {
    const prefix = user.email.split('@')[0];
    return prefix
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return 'Fábio Medeiros';
}

function showAuthFeedback(message, type = 'error') {
  if (!dom.authFeedback) return;
  dom.authFeedback.textContent = message;
  dom.authFeedback.classList.remove(
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

  if (type === 'success') {
    dom.authFeedback.classList.add('bg-emerald-500/10', 'border-emerald-500/30', 'text-emerald-300');
  } else if (type === 'info') {
    dom.authFeedback.classList.add('bg-blue-500/10', 'border-blue-500/30', 'text-blue-200');
  } else {
    dom.authFeedback.classList.add('bg-rose-500/10', 'border-rose-500/30', 'text-rose-300');
  }
}

function clearAuthFeedback() {
  if (!dom.authFeedback) return;
  dom.authFeedback.classList.add('hidden');
  dom.authFeedback.textContent = '';
}

function setSubmitting(loading) {
  state.isSubmitting = loading;
  dom.authSubmitBtn.disabled = loading;
  dom.authSubmitBtn.classList.toggle('opacity-80', loading);
  dom.authSubmitBtn.classList.toggle('cursor-wait', loading);

  if (loading) {
    dom.authSubmitLabel.textContent = state.authMode === 'signin' ? 'Validando acesso...' : 'Criando conta...';
    dom.authSubmitArrow.classList.add('hidden');
    dom.authSubmitSpinner.classList.remove('hidden');
  } else {
    dom.authSubmitLabel.textContent = state.authMode === 'signin' ? 'Acessar Ecossistema' : 'Criar Conta no Ecossistema';
    dom.authSubmitArrow.classList.remove('hidden');
    dom.authSubmitSpinner.classList.add('hidden');
  }
}

// ==========================================================================
// Supabase Client & Gemini Key Helpers
// ==========================================================================
function setCachedGeminiKey(key) {
  const clean = (key || '').trim();
  state.geminiApiKey = clean;
  if (typeof window !== 'undefined') {
    window.__VITALLY_GEMINI_KEY__ = clean;
  }
  if (clean) {
    localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, clean);
  } else {
    localStorage.removeItem(STORAGE_KEYS.GEMINI_KEY);
  }
}

function getEffectiveGeminiKey() {
  return (state.geminiApiKey || localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || '').trim();
}

function isAdminRoot() {
  return Boolean(state.isAuthenticated && state.userProfile?.role === 'admin_root');
}

function syncAdminControlsVisibility() {
  const admin = isAdminRoot();
  if (dom.openSupabaseHeader) {
    dom.openSupabaseHeader.classList.toggle('hidden', !admin);
  }
  if (dom.modalGeminiKeyGroup) {
    dom.modalGeminiKeyGroup.classList.toggle('hidden', !admin);
  }
}

function getStoredSupabaseConfig() {
  const storedUrl = (localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '').trim();
  const storedKey = (localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || '').trim();
  return {
    url: storedUrl || DEFAULT_SUPABASE_URL,
    key: storedKey || DEFAULT_SUPABASE_KEY,
    geminiKey: getEffectiveGeminiKey(),
  };
}

function initSupabaseClient() {
  const { url, key } = getStoredSupabaseConfig();
  if (url && key) {
    try {
      state.supabaseClient = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    } catch {
      state.supabaseClient = null;
    }
  } else {
    state.supabaseClient = null;
  }
  updateConnectionIndicators();
}

function updateConnectionIndicators() {
  const hasCloudConfig = Boolean(state.supabaseClient);

  if (dom.cloudIndicatorInline) {
    dom.cloudIndicatorInline.textContent = hasCloudConfig ? 'Nuvem configurada' : 'Local pronto';
    dom.cloudIndicatorInline.className = hasCloudConfig
      ? 'text-[11px] text-emerald-400 font-medium'
      : 'text-[11px] text-slate-400';
  }

  if (!dom.connectionStatusBadge) return;

  if (state.connectionMode === 'cloud' && state.isAuthenticated) {
    dom.connectionStatusBadge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-400/25 whitespace-nowrap';
    dom.connectionStatusIcon.setAttribute('data-lucide', 'cloud');
    dom.connectionStatusText.textContent = 'Nuvem Conectada';
  } else {
    dom.connectionStatusBadge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-400/20 whitespace-nowrap';
    dom.connectionStatusIcon.setAttribute('data-lucide', 'hard-drive');
    dom.connectionStatusText.textContent = 'Modo Local';
  }

  refreshIcons();
}

// ==========================================================================
// Auth Mode & Session Management
// ==========================================================================
function setAuthTab(mode) {
  state.authMode = mode;
  clearAuthFeedback();

  const isSignup = mode === 'signup';
  dom.tabSignin.classList.toggle('active', !isSignup);
  dom.tabSignup.classList.toggle('active', isSignup);
  dom.tabSignin.setAttribute('aria-selected', String(!isSignup));
  dom.tabSignup.setAttribute('aria-selected', String(isSignup));

  dom.signupNameWrapper.classList.toggle('hidden', !isSignup);
  dom.authPassword.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
  dom.authSubmitLabel.textContent = isSignup ? 'Criar Conta no Ecossistema' : 'Acessar Ecossistema';
}

async function fetchUserProfile(user) {
  const fallback = {
    role: 'operador',
    allowed_modules: ['sales', 'studio', 'apps'],
    full_name: extractDisplayName(user),
  };

  if (!state.supabaseClient || !user?.id) return fallback;

  try {
    let { data, error } = await state.supabaseClient
      .from('gv_user_profiles')
      .select('role, allowed_modules, full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      // Tolerant fallback if schema uses user_id instead of id
      const retry = await state.supabaseClient
        .from('gv_user_profiles')
        .select('role, allowed_modules, full_name')
        .eq('user_id', user.id)
        .maybeSingle();
      data = retry.data;
    }

    if (data) {
      const normalizedRole = data.role === 'admin_root' ? 'admin_root' : 'operador';
      const modules = Array.isArray(data.allowed_modules) && data.allowed_modules.length > 0
        ? data.allowed_modules
        : ['sales', 'studio', 'apps'];
      return {
        role: normalizedRole,
        allowed_modules: modules,
        full_name: data.full_name || fallback.full_name,
      };
    }
  } catch {
    // Keep resilient fallback if table or RLS denies
  }

  return fallback;
}

async function loadGeminiKeyFromSupabase(user, profile) {
  const localFallback = (localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || '').trim();
  if (!state.supabaseClient) {
    setCachedGeminiKey(localFallback);
    return localFallback;
  }

  let cloudKey = '';

  try {
    if (user?.id && profile?.role === 'admin_root') {
      const resById = await state.supabaseClient
        .from('gv_user_profiles')
        .select('gemini_api_key')
        .eq('id', user.id)
        .maybeSingle();

      if (!resById.error && typeof resById.data?.gemini_api_key === 'string' && resById.data.gemini_api_key.trim()) {
        cloudKey = resById.data.gemini_api_key.trim();
      } else if (resById.error) {
        const resByUserId = await state.supabaseClient
          .from('gv_user_profiles')
          .select('gemini_api_key')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!resByUserId.error && typeof resByUserId.data?.gemini_api_key === 'string' && resByUserId.data.gemini_api_key.trim()) {
          cloudKey = resByUserId.data.gemini_api_key.trim();
        }
      }
    }

    if (!cloudKey) {
      const adminRow = await state.supabaseClient
        .from('gv_user_profiles')
        .select('gemini_api_key')
        .eq('role', 'admin_root')
        .not('gemini_api_key', 'is', null)
        .limit(1)
        .maybeSingle();
      if (!adminRow.error && typeof adminRow.data?.gemini_api_key === 'string' && adminRow.data.gemini_api_key.trim()) {
        cloudKey = adminRow.data.gemini_api_key.trim();
      }
    }
  } catch {
    // Tolerant fallback if gv_user_profiles lacks gemini_api_key or RLS denies
  }

  if (!cloudKey) {
    try {
      const projRow = await state.supabaseClient
        .from('vf_projects')
        .select('gemini_api_key')
        .not('gemini_api_key', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!projRow.error && typeof projRow.data?.gemini_api_key === 'string' && projRow.data.gemini_api_key.trim()) {
        cloudKey = projRow.data.gemini_api_key.trim();
      }
    } catch {
      // Tolerant fallback if vf_projects lacks gemini_api_key
    }
  }

  const finalKey = cloudKey || localFallback;
  setCachedGeminiKey(finalKey);
  return finalKey;
}

async function saveGeminiKeyToSupabase(geminiKey) {
  if (!isAdminRoot()) return false;
  const clean = (geminiKey || '').trim();
  setCachedGeminiKey(clean);

  if (!state.supabaseClient || state.connectionMode !== 'cloud') {
    return false;
  }

  const valueToSave = clean || null;
  let savedCloud = false;

  if (state.user?.id) {
    try {
      const updById = await state.supabaseClient
        .from('gv_user_profiles')
        .update({ gemini_api_key: valueToSave })
        .eq('id', state.user.id)
        .select('id');

      if (!updById.error && Array.isArray(updById.data) && updById.data.length > 0) {
        savedCloud = true;
      } else {
        const updByUserId = await state.supabaseClient
          .from('gv_user_profiles')
          .update({ gemini_api_key: valueToSave })
          .eq('user_id', state.user.id)
          .select('id');
        if (!updByUserId.error && Array.isArray(updByUserId.data) && updByUserId.data.length > 0) {
          savedCloud = true;
        }
      }
    } catch {
      // Fall through to vf_projects fallback
    }
  }

  if (!savedCloud) {
    try {
      const { data: firstProj } = await state.supabaseClient
        .from('vf_projects')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstProj?.id) {
        const { error: projErr } = await state.supabaseClient
          .from('vf_projects')
          .update({ gemini_api_key: valueToSave })
          .eq('id', firstProj.id);
        if (!projErr) savedCloud = true;
      }
    } catch {
      // Keep local fallback
    }
  }

  return savedCloud;
}

function isModuleAllowed(moduleKey) {
  const profile = state.userProfile;
  if (!profile || profile.role === 'admin_root') return true;
  if (!Array.isArray(profile.allowed_modules) || profile.allowed_modules.length === 0) return true;
  if (profile.allowed_modules.includes('all') || profile.allowed_modules.includes('*')) return true;

  const aliases = {
    sales: ['sales', 'vitally_sales', 'Vitally Sales'],
    studio: ['studio', 'vitally_studio', 'Vitally Studio'],
    apps: ['apps', 'vitally_apps', 'Vitally Apps'],
  };
  const validNames = aliases[moduleKey] || [moduleKey];
  return profile.allowed_modules.some((m) => validNames.includes(m));
}

function applyModulePermissions() {
  document.querySelectorAll('[data-module]').forEach((card) => {
    const mod = card.getAttribute('data-module');
    const allowed = isModuleAllowed(mod);
    card.disabled = !allowed;
    card.classList.toggle('opacity-45', !allowed);
    card.classList.toggle('cursor-not-allowed', !allowed);
    card.setAttribute('aria-disabled', String(!allowed));
    card.title = allowed ? '' : 'Módulo restrito para o seu perfil de acesso.';
  });
}

function enterAuthenticatedWorkspace(user, mode = 'local', route = 'lobby', profile = null) {
  state.isAuthenticated = true;
  state.user = user;
  state.connectionMode = mode;
  state.userProfile = profile || {
    role: mode === 'local' ? 'admin_root' : 'operador',
    allowed_modules: ['sales', 'studio', 'apps'],
    full_name: extractDisplayName(user),
  };

  const displayName = state.userProfile.full_name || extractDisplayName(user);
  const roleSuffix = state.userProfile.role === 'admin_root' ? ' · Admin Root' : '';
  dom.userGreeting.textContent = `Olá, ${displayName}${roleSuffix}`;
  if (typeof window !== 'undefined') {
    window.__VITALLY_GEMINI_KEY__ = getEffectiveGeminiKey();
  }
  updateConnectionIndicators();
  applyModulePermissions();
  syncAdminControlsVisibility();

  stopLoginNeuralAnimation();
  dom.loginView.classList.add('hidden');
  dom.workspaceShell.classList.remove('hidden');

  navigateTo(route, { updateHash: true });
  refreshIcons();
}

function enterLocalOfflineSession() {
  const persist = dom.keepSession?.checked ?? true;
  const sessionPayload = JSON.stringify({
    ...DEFAULT_LOCAL_USER,
    authenticatedAt: new Date().toISOString(),
  });

  if (persist) {
    localStorage.setItem(STORAGE_KEYS.LOCAL_SESSION, sessionPayload);
    sessionStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
  } else {
    sessionStorage.setItem(STORAGE_KEYS.LOCAL_SESSION, sessionPayload);
    localStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
  }

  enterAuthenticatedWorkspace(DEFAULT_LOCAL_USER, 'local', getRouteFromHash(), {
    role: 'admin_root',
    allowed_modules: ['sales', 'studio', 'apps'],
    full_name: DEFAULT_LOCAL_USER.name,
  });
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) return;
  clearAuthFeedback();

  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value;
  const fullName = dom.authName.value.trim();

  if (!email || !email.includes('@')) {
    showAuthFeedback('Informe um e-mail corporativo válido.', 'error');
    dom.authEmail.focus();
    return;
  }

  if (!password || password.length < 6) {
    showAuthFeedback('A senha deve conter pelo menos 6 caracteres.', 'error');
    dom.authPassword.focus();
    return;
  }

  if (!state.supabaseClient) {
    showAuthFeedback(
      'Conexão com a nuvem indisponível no momento (Anon Key padrão ausente). Entre pelo "Modo Local (Offline)" ou contate o administrador.',
      'info'
    );
    return;
  }

  setSubmitting(true);

  try {
    if (state.authMode === 'signin') {
      const { data, error } = await state.supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        showAuthFeedback(error.message || 'Não foi possível autenticar. Verifique suas credenciais.', 'error');
        return;
      }

      if (data?.user) {
        localStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
        sessionStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
        const profile = await fetchUserProfile(data.user);
        await loadGeminiKeyFromSupabase(data.user, profile);
        enterAuthenticatedWorkspace(data.user, 'cloud', getRouteFromHash(), profile);
      }
    } else {
      const { data, error } = await state.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || 'Fábio Medeiros',
          },
        },
      });

      if (error) {
        showAuthFeedback(error.message || 'Erro ao criar conta no Supabase.', 'error');
        return;
      }

      if (data?.session && data?.user) {
        localStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
        sessionStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
        const profile = await fetchUserProfile(data.user);
        await loadGeminiKeyFromSupabase(data.user, profile);
        enterAuthenticatedWorkspace(data.user, 'cloud', 'lobby', profile);
      } else {
        showAuthFeedback(
          'Conta criada! Verifique seu e-mail para confirmar o cadastro ou tente entrar agora.',
          'success'
        );
        setAuthTab('signin');
      }
    }
  } catch (err) {
    showAuthFeedback(err?.message || 'Falha de rede ao conectar com o Supabase.', 'error');
  } finally {
    setSubmitting(false);
  }
}

async function handleLogout() {
  localStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
  sessionStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);

  if (state.connectionMode === 'cloud' && state.supabaseClient) {
    try {
      await state.supabaseClient.auth.signOut();
    } catch {
      // Proceed to clear client state even if offline
    }
  }

  state.isAuthenticated = false;
  state.user = null;
  state.connectionMode = 'local';
  state.userProfile = { role: 'operador', allowed_modules: ['sales', 'studio', 'apps'] };
  closeSupabaseModal();
  syncAdminControlsVisibility();

  dom.workspaceShell.classList.add('hidden');
  dom.loginView.classList.remove('hidden');
  dom.loginView.classList.remove('view-enter');
  void dom.loginView.offsetWidth;
  dom.loginView.classList.add('view-enter');
  startLoginNeuralAnimation();

  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  clearAuthFeedback();
  updateConnectionIndicators();
  refreshIcons();
}

// ==========================================================================
// Navigation & Routing
// ==========================================================================
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (raw === 'sales/vitally-flow') return 'sales-flow';
  if (VALID_ROUTES.includes(raw)) return raw;
  return 'lobby';
}

function getHashForRoute(route) {
  if (route === 'sales-flow') return '#sales/vitally-flow';
  return `#${route}`;
}

function isRouteAllowed(route) {
  if (route === 'sales' || route === 'sales-flow') return isModuleAllowed('sales');
  if (route === 'studio') return isModuleAllowed('studio');
  if (route === 'apps') return isModuleAllowed('apps');
  return true;
}

function navigateTo(route, { updateHash = true } = {}) {
  let targetRoute = VALID_ROUTES.includes(route) ? route : 'lobby';
  if (!isRouteAllowed(targetRoute)) {
    targetRoute = 'lobby';
  }
  state.currentRoute = targetRoute;

  Object.entries(dom.views).forEach(([key, sectionEl]) => {
    if (!sectionEl) return;
    if (key === targetRoute) {
      sectionEl.classList.remove('hidden', 'view-enter');
      void sectionEl.offsetWidth; // Reflow for clean compositor animation
      sectionEl.classList.add('view-enter');
      setTimeout(() => {
        sectionEl.classList.remove('view-enter');
      }, 280);
    } else {
      sectionEl.classList.add('hidden');
      sectionEl.classList.remove('view-enter');
    }
  });

  if (targetRoute === 'sales-flow') {
    initVitallyFlow({
      supabaseClient: state.supabaseClient,
      user: state.user,
      profile: state.userProfile,
      mode: state.connectionMode,
      geminiApiKey: getEffectiveGeminiKey(),
    });
  }

  if (updateHash) {
    const nextHash = getHashForRoute(targetRoute);
    if (window.location.hash !== nextHash) {
      history.pushState({ route: targetRoute }, '', nextHash);
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshIcons();
}

// ==========================================================================
// Vitally Apps — Fôlego IA Configurable URL
// ==========================================================================
function syncFolegoUi(savedUrl) {
  if (!dom.folegoUrlInput || !dom.folegoOpenLink || !dom.folegoStatusPill) return;

  dom.folegoUrlInput.value = savedUrl || '';

  if (isValidHttpUrl(savedUrl)) {
    dom.folegoOpenLink.href = savedUrl;
    dom.folegoOpenLink.setAttribute('aria-disabled', 'false');
    dom.folegoOpenLink.className =
      'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-500 text-white text-xs sm:text-sm font-medium shadow-lg shadow-blue-600/20 transition-all whitespace-nowrap';
    dom.folegoStatusPill.textContent = 'Publicado';
    dom.folegoStatusPill.className =
      'text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 px-2.5 py-1 rounded-md';
  } else {
    dom.folegoOpenLink.href = '#';
    dom.folegoOpenLink.setAttribute('aria-disabled', 'true');
    dom.folegoOpenLink.className =
      'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/70 text-slate-400 border border-sky-400/15 text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-not-allowed';
    dom.folegoStatusPill.textContent = 'Configurar URL';
    dom.folegoStatusPill.className =
      'text-xs font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-400/20 px-2.5 py-1 rounded-md';
  }
}

function handleFolegoUrlSave(event) {
  event.preventDefault();
  const value = dom.folegoUrlInput.value.trim();

  if (!value) {
    localStorage.removeItem(STORAGE_KEYS.FOLEGO_URL);
    syncFolegoUi('');
    showFolegoFeedback('Link removido.', 'info');
    return;
  }

  if (!isValidHttpUrl(value)) {
    showFolegoFeedback('Insira uma URL válida iniciando com https://', 'error');
    return;
  }

  localStorage.setItem(STORAGE_KEYS.FOLEGO_URL, value);
  syncFolegoUi(value);
  showFolegoFeedback('Link do Fôlego IA salvo localmente.', 'success');
}

function showFolegoFeedback(text, type) {
  if (!dom.folegoUrlFeedback) return;
  dom.folegoUrlFeedback.textContent = text;
  dom.folegoUrlFeedback.classList.remove('hidden', 'text-emerald-400', 'text-rose-400', 'text-slate-400');
  dom.folegoUrlFeedback.classList.add(
    type === 'error' ? 'text-rose-400' : type === 'info' ? 'text-slate-400' : 'text-emerald-400'
  );
  setTimeout(() => {
    dom.folegoUrlFeedback?.classList.add('hidden');
  }, 3200);
}

// ==========================================================================
// Modals (Admin Root API Config & Sales Expansion)
// ==========================================================================
async function openSupabaseModal() {
  if (!isAdminRoot()) return;
  syncAdminControlsVisibility();

  const { url, key, geminiKey } = getStoredSupabaseConfig();
  dom.supabaseUrlInput.value = url || DEFAULT_SUPABASE_URL;
  dom.supabaseKeyInput.value = key;
  if (dom.modalGeminiKeyInput) {
    dom.modalGeminiKeyInput.value = geminiKey;
  }
  dom.supabaseModalFeedback.classList.add('hidden');
  dom.supabaseModal.classList.remove('hidden');
  (dom.modalGeminiKeyInput || dom.supabaseKeyInput)?.focus();
  refreshIcons();

  if (state.supabaseClient && state.connectionMode === 'cloud') {
    const initialInputVal = dom.modalGeminiKeyInput?.value || '';
    const latestCloudKey = await loadGeminiKeyFromSupabase(state.user, state.userProfile);
    if (
      dom.modalGeminiKeyInput &&
      latestCloudKey &&
      dom.modalGeminiKeyInput.value === initialInputVal &&
      !dom.supabaseModal.classList.contains('hidden')
    ) {
      dom.modalGeminiKeyInput.value = latestCloudKey;
    }
  }
}

function closeSupabaseModal() {
  dom.supabaseModal?.classList.add('hidden');
}

function showSupabaseModalFeedback(msg, type = 'success') {
  dom.supabaseModalFeedback.textContent = msg;
  dom.supabaseModalFeedback.classList.remove(
    'hidden',
    'bg-emerald-500/10',
    'border-emerald-500/30',
    'text-emerald-300',
    'bg-rose-500/10',
    'border-rose-500/30',
    'text-rose-300'
  );

  if (type === 'error') {
    dom.supabaseModalFeedback.classList.add('bg-rose-500/10', 'border-rose-500/30', 'text-rose-300');
  } else {
    dom.supabaseModalFeedback.classList.add('bg-emerald-500/10', 'border-emerald-500/30', 'text-emerald-300');
  }
}

async function handleSupabaseSave(event) {
  event.preventDefault();
  if (!isAdminRoot()) return;

  const url = (dom.supabaseUrlInput.value || '').trim() || DEFAULT_SUPABASE_URL;
  const key = (dom.supabaseKeyInput.value || '').trim();
  const geminiKey = (dom.modalGeminiKeyInput?.value || '').trim();

  localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
  if (key && key !== DEFAULT_SUPABASE_KEY) {
    localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key);
  } else if (!key) {
    localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
  }

  initSupabaseClient();
  const savedGeminiInCloud = await saveGeminiKeyToSupabase(geminiKey);

  if (state.isAuthenticated && state.currentRoute === 'sales-flow') {
    updateVitallyFlowContext({
      supabaseClient: state.supabaseClient,
      user: state.user,
      profile: state.userProfile,
      mode: state.connectionMode,
      geminiApiKey: getEffectiveGeminiKey(),
    });
  }

  const msg = savedGeminiInCloud
    ? 'Chave Gemini salva no Supabase e credenciais sincronizadas!'
    : state.supabaseClient
      ? 'Chaves salvas localmente e conexão Supabase ativa!'
      : 'Chaves salvas localmente no navegador.';
  showSupabaseModalFeedback(msg, 'success');

  setTimeout(() => {
    closeSupabaseModal();
  }, 850);
}

async function handleSupabaseClear() {
  if (!isAdminRoot()) return;

  localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
  localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
  setCachedGeminiKey('');

  if (state.connectionMode === 'cloud' && state.supabaseClient) {
    await saveGeminiKeyToSupabase('');
  }

  dom.supabaseUrlInput.value = DEFAULT_SUPABASE_URL;
  dom.supabaseKeyInput.value = DEFAULT_SUPABASE_KEY;
  if (dom.modalGeminiKeyInput) dom.modalGeminiKeyInput.value = '';
  initSupabaseClient();
  if (state.isAuthenticated && state.currentRoute === 'sales-flow') {
    updateVitallyFlowContext({
      supabaseClient: state.supabaseClient,
      user: state.user,
      profile: state.userProfile,
      mode: state.connectionMode,
      geminiApiKey: '',
    });
  }
  showSupabaseModalFeedback('Chaves limpas com segurança.', 'success');
}

function openInfoModal() {
  dom.infoModal.classList.remove('hidden');
  refreshIcons();
}

function closeInfoModal() {
  dom.infoModal.classList.add('hidden');
}

// ==========================================================================
// Event Bindings & Bootstrap
// ==========================================================================
function bindEvents() {
  // Auth Tabs
  dom.tabSignin?.addEventListener('click', () => setAuthTab('signin'));
  dom.tabSignup?.addEventListener('click', () => setAuthTab('signup'));

  // Password Toggle
  dom.togglePasswordBtn?.addEventListener('click', () => {
    const isPassword = dom.authPassword.type === 'password';
    dom.authPassword.type = isPassword ? 'text' : 'password';
    dom.togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    const iconEl = dom.togglePasswordBtn.querySelector('svg, i');
    if (iconEl) {
      iconEl.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    }
    refreshIcons();
  });

  // Auth Form Submit & Local Mode
  dom.authForm?.addEventListener('submit', handleAuthSubmit);
  dom.localModeBtn?.addEventListener('click', enterLocalOfflineSession);

  // Header Actions
  dom.brandHomeBtn?.addEventListener('click', () => navigateTo('lobby'));
  dom.logoutBtn?.addEventListener('click', handleLogout);

  // Declarative Navigation Buttons ([data-navigate])
  document.querySelectorAll('[data-navigate]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-navigate');
      if (target) navigateTo(target);
    });
  });

  // Browser History Back/Forward
  window.addEventListener('popstate', () => {
    if (state.isAuthenticated) {
      navigateTo(getRouteFromHash(), { updateHash: false });
    }
  });

  // Admin Root API Keys Modal
  dom.openSupabaseHeader?.addEventListener('click', openSupabaseModal);
  dom.closeSupabaseModal?.addEventListener('click', closeSupabaseModal);
  dom.cancelSupabaseModal?.addEventListener('click', closeSupabaseModal);
  dom.supabaseConfigForm?.addEventListener('submit', handleSupabaseSave);
  dom.clearSupabaseBtn?.addEventListener('click', handleSupabaseClear);
  dom.toggleModalGeminiKey?.addEventListener('click', () => {
    if (!dom.modalGeminiKeyInput) return;
    const isPassword = dom.modalGeminiKeyInput.type === 'password';
    dom.modalGeminiKeyInput.type = isPassword ? 'text' : 'password';
    const iconEl = dom.toggleModalGeminiKey.querySelector('svg, i');
    if (iconEl) {
      iconEl.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    }
    refreshIcons();
  });
  dom.supabaseModal?.addEventListener('click', (e) => {
    if (e.target === dom.supabaseModal) closeSupabaseModal();
  });

  // Sales Expansion Info Modal
  dom.newSalesModuleBtn?.addEventListener('click', openInfoModal);
  dom.closeInfoModal?.addEventListener('click', closeInfoModal);
  dom.confirmInfoModal?.addEventListener('click', closeInfoModal);
  dom.infoModal?.addEventListener('click', (e) => {
    if (e.target === dom.infoModal) closeInfoModal();
  });

  // Escape key closes open modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.supabaseModal.classList.contains('hidden')) closeSupabaseModal();
      if (!dom.infoModal.classList.contains('hidden')) closeInfoModal();
    }
  });

  // Fôlego IA URL Management
  dom.folegoUrlForm?.addEventListener('submit', handleFolegoUrlSave);
  dom.folegoOpenLink?.addEventListener('click', (e) => {
    if (dom.folegoOpenLink.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      dom.folegoUrlInput?.focus();
      showFolegoFeedback('Salve primeiro a URL do GitHub Pages para abrir o Fôlego IA.', 'info');
    }
  });
}

// ==========================================================================
// High-Tech Studio Background: Neural Mesh Canvas (Login Left Panel)
// ==========================================================================
const neuralScene = {
  initialized: false,
  rafId: null,
  width: 0,
  height: 0,
  dpr: 1,
  nodes: [],
  mouse: { x: -9999, y: -9999, targetX: -9999, targetY: -9999, active: false },
  resizeObserver: null,
};

function createNeuralNodes(width, height) {
  const area = Math.max(1, width * height);
  const count = Math.max(26, Math.min(64, Math.round(area / 12500)));
  const nodes = [];
  for (let i = 0; i < count; i += 1) {
    const isCyan = i % 3 === 0;
    nodes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.38,
      vy: (Math.random() - 0.5) * 0.38,
      radius: 1.3 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      color: isCyan ? '6, 182, 212' : '37, 99, 235',
      coreColor: isCyan ? '34, 211, 238' : '96, 165, 250',
    });
  }
  return nodes;
}

function resizeLoginNeuralCanvas() {
  const canvas = dom.loginNeuralCanvas;
  const panel = dom.loginBrandPanel;
  if (!canvas || !panel) return;

  const rect = panel.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (width === neuralScene.width && height === neuralScene.height && dpr === neuralScene.dpr) {
    return;
  }

  neuralScene.width = width;
  neuralScene.height = height;
  neuralScene.dpr = dpr;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  neuralScene.nodes = createNeuralNodes(width, height);
}

function renderLoginNeuralFrame(timeMs = 0, animateNodes = true) {
  const canvas = dom.loginNeuralCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height, dpr, nodes, mouse } = neuralScene;
  if (width <= 1 || height <= 1) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (mouse.active) {
    mouse.x += (mouse.targetX - mouse.x) * 0.08;
    mouse.y += (mouse.targetY - mouse.y) * 0.08;

    const halo = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 175);
    halo.addColorStop(0, 'rgba(6, 182, 212, 0.14)');
    halo.addColorStop(0.5, 'rgba(37, 99, 235, 0.07)');
    halo.addColorStop(1, 'rgba(7, 11, 20, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 175, 0, Math.PI * 2);
    ctx.fill();
  }

  const maxConnectDist = 132;
  const mouseInfluenceRadius = 170;

  if (animateNodes) {
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;

      if (mouse.active) {
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 16 && dist < mouseInfluenceRadius) {
          const pull = (1 - dist / mouseInfluenceRadius) * 0.018;
          n.x += dx * pull;
          n.y += dy * pull;
        }
      }

      if (n.x < -12) n.x = width + 12;
      if (n.x > width + 12) n.x = -12;
      if (n.y < -12) n.y = height + 12;
      if (n.y > height + 12) n.y = -12;
    }
  }

  // Connecting lines between nearby nodes
  ctx.lineWidth = 0.85;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < maxConnectDist) {
        const t = 1 - dist / maxConnectDist;
        let boost = 0;
        if (mouse.active) {
          const midX = (a.x + b.x) * 0.5;
          const midY = (a.y + b.y) * 0.5;
          const mDist = Math.hypot(mouse.x - midX, mouse.y - midY);
          if (mDist < mouseInfluenceRadius) {
            boost = (1 - mDist / mouseInfluenceRadius) * 0.28;
          }
        }
        const alpha = Math.min(0.55, t * t * 0.28 + boost);
        ctx.strokeStyle = boost > 0.08 ? `rgba(34, 211, 238, ${alpha})` : `rgba(59, 130, 246, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    if (mouse.active) {
      const mDx = mouse.x - a.x;
      const mDy = mouse.y - a.y;
      const mDist = Math.hypot(mDx, mDy);
      if (mDist < mouseInfluenceRadius * 0.92) {
        const t = 1 - mDist / (mouseInfluenceRadius * 0.92);
        ctx.strokeStyle = `rgba(6, 182, 212, ${(t * 0.34).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }
  }

  // Glowing neural particles
  const pulseBase = timeMs * 0.0022;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    const pulse = 0.78 + 0.22 * Math.sin(pulseBase + n.phase);
    let hoverScale = 1;
    if (mouse.active) {
      const mDist = Math.hypot(mouse.x - n.x, mouse.y - n.y);
      if (mDist < mouseInfluenceRadius) {
        hoverScale = 1 + (1 - mDist / mouseInfluenceRadius) * 0.65;
      }
    }

    const r = n.radius * hoverScale;
    ctx.fillStyle = `rgba(${n.color}, ${(0.22 * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r * 2.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(${n.coreColor}, ${(0.72 * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function initLoginNeuralCanvas() {
  if (neuralScene.initialized) return;
  if (!dom.loginNeuralCanvas || !dom.loginBrandPanel) return;
  neuralScene.initialized = true;

  resizeLoginNeuralCanvas();

  if (typeof ResizeObserver !== 'undefined') {
    neuralScene.resizeObserver = new ResizeObserver(() => {
      resizeLoginNeuralCanvas();
      if (neuralScene.rafId === null && !dom.loginView?.classList.contains('hidden')) {
        renderLoginNeuralFrame(0, false);
      }
    });
    neuralScene.resizeObserver.observe(dom.loginBrandPanel);
  } else {
    window.addEventListener('resize', resizeLoginNeuralCanvas);
  }

  dom.loginBrandPanel.addEventListener(
    'pointermove',
    (e) => {
      const rect = dom.loginBrandPanel.getBoundingClientRect();
      neuralScene.mouse.targetX = e.clientX - rect.left;
      neuralScene.mouse.targetY = e.clientY - rect.top;
      if (!neuralScene.mouse.active) {
        neuralScene.mouse.x = neuralScene.mouse.targetX;
        neuralScene.mouse.y = neuralScene.mouse.targetY;
      }
      neuralScene.mouse.active = true;
    },
    { passive: true }
  );

  dom.loginBrandPanel.addEventListener('pointerleave', () => {
    neuralScene.mouse.active = false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopLoginNeuralAnimation();
    } else if (!state.isAuthenticated && !dom.loginView?.classList.contains('hidden')) {
      startLoginNeuralAnimation();
    }
  });
}

function startLoginNeuralAnimation() {
  initLoginNeuralCanvas();
  if (!dom.loginNeuralCanvas || dom.loginView?.classList.contains('hidden')) return;
  resizeLoginNeuralCanvas();

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    renderLoginNeuralFrame(0, false);
    return;
  }

  if (neuralScene.rafId !== null) return;
  const tick = (now) => {
    if (dom.loginView?.classList.contains('hidden') || document.visibilityState === 'hidden') {
      neuralScene.rafId = null;
      return;
    }
    renderLoginNeuralFrame(now, true);
    neuralScene.rafId = window.requestAnimationFrame(tick);
  };
  neuralScene.rafId = window.requestAnimationFrame(tick);
}

function stopLoginNeuralAnimation() {
  if (neuralScene.rafId !== null) {
    window.cancelAnimationFrame(neuralScene.rafId);
    neuralScene.rafId = null;
  }
}

async function restoreSessionOnLoad() {
  // 1. Restore Fôlego IA link
  const savedFolegoUrl = localStorage.getItem(STORAGE_KEYS.FOLEGO_URL) || '';
  syncFolegoUi(savedFolegoUrl);

  // 2. Check Supabase Cloud Session if configured
  if (state.supabaseClient) {
    try {
      const { data } = await state.supabaseClient.auth.getSession();
      if (data?.session?.user) {
        const profile = await fetchUserProfile(data.session.user);
        await loadGeminiKeyFromSupabase(data.session.user, profile);
        enterAuthenticatedWorkspace(data.session.user, 'cloud', getRouteFromHash(), profile);
        return;
      }
    } catch {
      // Fallback gracefully to local session check
    }
  }

  // 3. Check Local Offline Session
  const rawLocal =
    localStorage.getItem(STORAGE_KEYS.LOCAL_SESSION) ||
    sessionStorage.getItem(STORAGE_KEYS.LOCAL_SESSION);

  if (rawLocal) {
    try {
      const parsed = JSON.parse(rawLocal);
      setCachedGeminiKey(localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || '');
      enterAuthenticatedWorkspace(parsed, 'local', getRouteFromHash(), {
        role: 'admin_root',
        allowed_modules: ['sales', 'studio', 'apps'],
        full_name: parsed.name || DEFAULT_LOCAL_USER.name,
      });
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
      sessionStorage.removeItem(STORAGE_KEYS.LOCAL_SESSION);
    }
  }

  // 4. Default: Show Login Split-Screen
  syncAdminControlsVisibility();
  dom.loginView.classList.remove('hidden');
  dom.workspaceShell.classList.add('hidden');
  startLoginNeuralAnimation();
  refreshIcons();
}

function bootstrap() {
  initSupabaseClient();
  bindEvents();
  restoreSessionOnLoad();
  refreshIcons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
