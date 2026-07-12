(() => {
  const root = globalThis.ClaudeTimeline = globalThis.ClaudeTimeline || {};
  const API_PREFIX = '/api/organizations';

  class ClaudeConversationError extends Error {
    constructor(code, message, cause = null) {
      super(message);
      this.name = 'ClaudeConversationError';
      this.code = code;
      this.cause = cause;
    }
  }

  const extractConversationId = (pathname = location.pathname) => {
    const match = String(pathname || '').match(/^\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  };

  const readOrganizationId = (value) => {
    if (!value || typeof value !== 'object') return null;
    const keys = ['organization_uuid', 'organizationUuid', 'organization_id', 'organizationId'];
    for (const key of keys) {
      if (typeof value[key] === 'string' && value[key]) return value[key];
    }
    return null;
  };

  // The organizations endpoint has changed shape over time. Accept an array, an
  // object containing one, or a single organization while still requiring a UUID.
  const pickOrganizationId = (payload) => {
    const direct = readOrganizationId(payload);
    if (direct) return direct;
    const candidates = Array.isArray(payload)
      ? payload
      : (payload?.organizations || payload?.data || payload?.items || []);
    if (!Array.isArray(candidates)) return null;
    const first = candidates.find(item => item && typeof item.uuid === 'string' && item.uuid);
    return first?.uuid || null;
  };

  const fetchJson = async (url, { signal } = {}) => {
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ClaudeConversationError('network', `Claude API request failed: ${url}`, error);
    }
    if (!response.ok) {
      throw new ClaudeConversationError('http', `Claude API returned ${response.status} for ${url}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ClaudeConversationError('json', `Claude API returned invalid JSON for ${url}`, error);
    }
  };

  const getOrganizationId = async ({ signal, cachedOrganizationId } = {}) => {
    if (cachedOrganizationId) return cachedOrganizationId;

    // Claude exposes the active organization in some page bootstrap nodes. This
    // is intentionally best-effort; the API response remains the source of truth.
    const bootstrap = document.querySelector('[data-organization-uuid], [data-organization-id]');
    const fromDom = bootstrap?.getAttribute('data-organization-uuid') || bootstrap?.getAttribute('data-organization-id');
    if (fromDom) return fromDom;

    const organizations = await fetchJson(API_PREFIX, { signal });
    const id = pickOrganizationId(organizations);
    if (!id) throw new ClaudeConversationError('organization', 'Unable to determine the active Claude organization');
    return id;
  };

  const fetchConversation = async (conversationId, { signal, organizationId } = {}) => {
    if (!conversationId) throw new ClaudeConversationError('conversation', 'Missing conversation UUID');
    const orgId = await getOrganizationId({ signal, cachedOrganizationId: organizationId });
    const params = new URLSearchParams({
      tree: 'true',
      rendering_mode: 'messages',
      render_all_tools: 'true',
      consistency: 'strong'
    });
    const payload = await fetchJson(`${API_PREFIX}/${encodeURIComponent(orgId)}/chat_conversations/${encodeURIComponent(conversationId)}?${params}`, { signal });
    return { organizationId: orgId, payload };
  };

  root.api = { ClaudeConversationError, extractConversationId, fetchConversation };
})();
