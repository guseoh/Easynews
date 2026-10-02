export const CHATGPT_MESSAGES: Record<string, string> = {
  CHATGPT_USAGE_LIMIT: 'ChatGPT 사용 한도에 도달했습니다. Manage usage에서 앱과 플랜 한도를 확인해 주세요.',
  CHATGPT_SIGN_IN_REQUIRED: 'ChatGPT에 연결하고 plan 사용을 승인해 주세요.',
  CHATGPT_SHARING_DISABLED: 'ChatGPT plan 사용 권한을 승인해 주세요.',
  CHATGPT_NOT_ELIGIBLE: '이 계정·지역·권한에서는 ChatGPT plan을 사용할 수 없습니다.',
  CHATGPT_AUTH_ERROR: 'ChatGPT 연결의 인증·plan 권한이 거부됐습니다. 연결 정보를 확인해 주세요.',
  CHATGPT_NO_MODEL: '이 계정에서 사용할 수 있는 설명 모델이 없습니다.',
  CHATGPT_STORAGE_ERROR: '보호된 ChatGPT 연결 정보를 사용할 수 없습니다. Windows 보호 저장소를 확인해 주세요.',
  CHATGPT_IDENTITY_ERROR: 'ChatGPT 신원을 검증하지 못했습니다. 다시 연결해 주세요.',
  CHATGPT_ACCESS_DENIED: 'ChatGPT 연결 승인이 취소됐습니다.',
  CHATGPT_REVOCATION_UNCONFIRMED: '로컬 연결은 해제했지만 원격 해제를 확인하지 못했습니다. ChatGPT 설정에서 Easynews를 해제해 주세요.',
  CHATGPT_BUSY: '진행 중인 연결 변경을 완료해 주세요.',
  CHATGPT_FAILED: 'ChatGPT 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.',
};
export interface AiStatus {
  provider: 'api-key' | 'chatgpt-plan'; status: string; sharing: boolean;
  model?: string; account?: string; profileLabel?: string; usageLimited?: boolean;
  error?: { code: string };
}

export async function requestAiConnection(action: 'status' | 'profiles' | 'connect' | 'disconnect' | 'recheck' | 'cancel', options: object = {}, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  const get = action === 'status' || action === 'profiles';
  const response = await fetcher(`http://127.0.0.1:3000/api/ai/${action}`, {
    method: get ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Easynews-Extension': chrome.runtime.id },
    ...(get ? {} : { body: JSON.stringify(options) }), cache: 'no-store', signal: signal ?? AbortSignal.timeout(20_000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error ? data.error.code : undefined;
    throw new Error(typeof code === 'string' ? CHATGPT_MESSAGES[code] || 'AI 연결 요청에 실패했습니다.' : 'AI 연결 요청에 실패했습니다.');
  }
  return data;
}

export function validateAiStatus(data: unknown): AiStatus {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('AI 연결 상태를 읽지 못했습니다.');
  const value = data as Record<string, unknown>;
  if (!['api-key', 'chatgpt-plan'].includes(String(value.provider)) || !['connected', 'connecting', 'disconnected', 'reauth_required'].includes(String(value.status))
    || typeof value.sharing !== 'boolean' || ['model', 'account', 'profileLabel'].some((key) => value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 254))) throw new Error('AI 연결 상태를 읽지 못했습니다.');
  // Copy only UI metadata. Even a malformed server cannot return credentials to callers.
  return { provider: value.provider as AiStatus['provider'], status: value.status as string, sharing: value.sharing,
    ...(typeof value.model === 'string' ? { model: value.model } : {}), ...(typeof value.account === 'string' ? { account: value.account } : {}),
    ...(typeof value.profileLabel === 'string' ? { profileLabel: value.profileLabel } : {}), usageLimited: value.usageLimited === true,
    ...(value.error && typeof value.error === 'object' && 'code' in value.error && typeof value.error.code === 'string' && Object.hasOwn(CHATGPT_MESSAGES, value.error.code) ? { error: { code: value.error.code } } : {}) };
}

export function mountChatGPTConnection(onChange: (enabled: boolean, invalidate: boolean) => void) {
  const message = document.querySelector<HTMLParagraphElement>('#ai-connection-status')!;
  const connect = document.querySelector<HTMLButtonElement>('#connect-chatgpt')!;
  const disconnect = document.querySelector<HTMLButtonElement>('#disconnect-chatgpt')!;
  const recheck = document.querySelector<HTMLButtonElement>('#recheck-chatgpt')!;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel-chatgpt')!;
  const accounts = document.querySelector<HTMLSelectElement>('#chatgpt-accounts')!;
  const usage = document.querySelector<HTMLAnchorElement>('#manage-usage')!;
  const welcome = document.querySelector<HTMLDialogElement>('#chatgpt-welcome')!;
  let closed = false, acting = false, lastIdentity = '', lastStatus = '', current: AiStatus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  async function showWelcome() {
    try {
      if (!(await chrome.storage.local.get('chatgptWelcomeSeen')).chatgptWelcomeSeen && !closed) {
        welcome.showModal();
        await chrome.storage.local.set({ chatgptWelcomeSeen: true });
      }
    } catch { /* Missing preference storage never exposes or blocks credentials. */ }
  }

  async function sync() {
    if (closed) return;
    try {
      const next = validateAiStatus(await requestAiConnection('status', {}, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])));
      if (closed) return;
      current = next;
      const plan = next.provider === 'chatgpt-plan';
      const enabled = !plan || (next.sharing && next.status === 'connected' && !!next.model && !next.usageLimited);
      const identity = `${next.account || ''}:${next.profileLabel || ''}`;
      const completedConnectionChange = lastStatus === 'connecting' && next.status !== 'connecting';
      onChange(enabled, !!lastStatus && (identity !== lastIdentity || next.status !== lastStatus));
      lastIdentity = identity; lastStatus = next.status;
      message.textContent = !plan ? 'API Key 방식으로 실행 중입니다.'
        : next.usageLimited ? CHATGPT_MESSAGES.CHATGPT_USAGE_LIMIT!
        : next.error ? CHATGPT_MESSAGES[next.error.code]!
        : next.status === 'connecting' ? '브라우저에서 ChatGPT 연결을 승인해 주세요…'
        : enabled ? `ChatGPT 연결됨 · Using ChatGPT plan${next.account ? ` · ${next.account}` : ''}`
        : next.sharing ? '사용할 수 있는 모델을 확인해 주세요.' : 'AI 설명을 사용하려면 ChatGPT를 연결하세요. ChatGPT 대화 내역에는 접근하지 않습니다.';
      connect.hidden = !plan || next.status === 'connecting'; connect.disabled = acting;
      connect.textContent = next.status === 'connected' && !next.sharing ? 'ChatGPT plan 사용 승인' : 'Continue with ChatGPT';
      disconnect.hidden = !plan || next.status === 'disconnected'; disconnect.disabled = acting;
      cancel.hidden = next.status !== 'connecting';
      recheck.hidden = !plan || next.status === 'connecting'; recheck.disabled = acting;
      accounts.hidden = !plan || next.status === 'connecting'; accounts.disabled = acting;
      usage.hidden = !plan;
      if (enabled && plan) void showWelcome();
      if (completedConnectionChange) void profiles();
    } catch {
      if (!closed) message.textContent = '로컬 서버의 AI 연결 상태를 확인하지 못했습니다. 서버 실행 후 다시 확인해 주세요.';
    } finally {
      clearTimeout(timer);
      if (!closed && current?.status === 'connecting') timer = setTimeout(() => void sync(), 2_000);
    }
  }

  async function profiles() {
    try {
      const data = await requestAiConnection('profiles', {}, controller.signal);
      if (closed || !data || typeof data !== 'object' || !('profiles' in data) || !Array.isArray(data.profiles)) return;
      accounts.replaceChildren(new Option('현재 연결', ''), new Option('다른 계정 추가', '__new__'));
      for (const profile of data.profiles.slice(0, 50)) {
        if (profile && typeof profile === 'object' && typeof profile.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(profile.id) && typeof profile.label === 'string') accounts.add(new Option(profile.label.slice(0, 100), profile.id));
      }
    } catch { /* Status reports connection failures independently. */ }
  }

  async function act(action: 'connect' | 'disconnect' | 'recheck' | 'cancel') {
    if (closed || acting) return;
    acting = true;
    if (action === 'connect' || action === 'disconnect') onChange(false, true);
    try {
      const options = action !== 'connect' ? {} : accounts.value === '__new__' ? { newProfile: true }
        : { ...(accounts.value ? { profileId: accounts.value } : {}), ...(current?.status === 'connected' && !current.sharing ? { reconsent: true } : {}) };
      await requestAiConnection(action, options, AbortSignal.any([controller.signal, AbortSignal.timeout(action === 'disconnect' ? 120_000 : 20_000)]));
      await sync();
      if (current?.status !== 'connecting') await profiles();
    } catch (error) {
      if (!closed) { await sync(); message.textContent = error instanceof Error ? error.message : 'AI 연결 요청에 실패했습니다.'; }
    } finally { acting = false; connect.disabled = false; disconnect.disabled = false; recheck.disabled = false; accounts.disabled = false; }
  }

  connect.addEventListener('click', () => void act('connect'));
  disconnect.addEventListener('click', () => void act('disconnect'));
  recheck.addEventListener('click', () => void act('recheck'));
  cancel.addEventListener('click', () => void act('cancel'));
  document.querySelector<HTMLButtonElement>('#dismiss-chatgpt-welcome')!.addEventListener('click', () => welcome.close());
  window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); controller.abort(); welcome.close(); });
  void sync().then(() => { if (current?.provider === 'chatgpt-plan') void profiles(); });
  return { refresh: () => void sync() };
}
