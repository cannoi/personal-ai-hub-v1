/** Lightweight, dependency-free language and response-quality guidance for the Hub's own assistant.
 * Transparent /v1 requests deliberately do not use this helper: client prompts remain authoritative.
 */
export function messageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  }).join(' ');
  return '';
}

export function detectReplyLanguage(messages = [], fallback = 'en') {
  const lastUser = [...messages].reverse().find(m => m?.role === 'user');
  const text = messageText(lastUser?.content).trim();
  if (!text) return fallback === 'vi' ? 'vi' : 'en';
  // Vietnamese diacritics are a strong signal; common unaccented Vietnamese words cover mobile users without tone marks.
  if (/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(text)) return 'vi';
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]+/g) || [];
  const viWords = new Set(['toi','ban','minh','giup','hay','cho','lam','sao','nao','duoc','khong','app','loi','cai','dat','phan','tich','xin','chao','cam','on','tieng','viet','mo','hinh','tra','loi','the','nay','voi','nhe','nhe','co','la','gi','mot','nhu','va','nhung','can','muon']);
  const enWords = new Set(['the','and','you','your','please','what','how','why','when','where','can','could','would','help','with','this','that','is','are','for','from','app','error','fix','analyze','make','want','need','hello','thanks']);
  const vi = words.filter(w => viWords.has(w)).length;
  const en = words.filter(w => enWords.has(w)).length;
  if (vi > en && vi >= 1) return 'vi';
  if (en > vi && en >= 1) return 'en';
  return fallback === 'vi' ? 'vi' : 'en';
}

export function buildHubAssistantSystem({ system = '', messages = [], uiLanguage = 'en', appKnowledge = '', memories = '' } = {}) {
  const language = detectReplyLanguage(messages, uiLanguage);
  const languageRule = language === 'vi'
    ? 'LANGUAGE: Reply in natural Vietnamese. Keep product labels, API names, code, and model IDs unchanged where appropriate.'
    : 'LANGUAGE: Reply in natural English. Keep product labels, API names, code, and model IDs unchanged where appropriate.';
  const qualityRules = [
    'Be genuinely useful to a non-technical user: lead with the direct answer, then give clear actionable steps.',
    'Be accurate and honest. Never invent settings, provider capabilities, test results, or facts about this installation.',
    'If essential information is missing, ask one focused clarification. If uncertain, state the uncertainty and suggest a safe way to verify.',
    'Use concise structure, relevant icons sparingly, and avoid repeating the question. Do not expose secrets or private configuration.'
  ].join(' ');
  return [
    system || 'You are the Personal AI Hub assistant for this SoloHost AI Gateway.',
    qualityRules,
    languageRule,
    appKnowledge ? `APP KNOWLEDGE (authoritative; do not contradict):\n${appKnowledge}` : '',
    memories ? `Relevant recent private interaction memory for this app only:\n${memories}` : ''
  ].filter(Boolean).join('\n\n');
}
