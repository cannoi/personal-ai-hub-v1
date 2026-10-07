'use strict';
const ALLOWED = new Set(['open_tab', 'show_lan', 'pause_hint']);
const adapter = {
  knowledge: `
Snake Classic is a multiplayer snake arcade on SoloHost.
Screens: main menu, room lobby, play canvas, game over, settings (gear), LAN connect, help.
Controls: arrow keys or WASD on desktop; swipe or on-screen pad on phone. Gear/Esc opens settings.
Modes: Co-op (shared lives), Survival (last alive), Time Attack (90s), Campaign (themed maps with obstacles).
Eat apples to grow. Do not hit walls, yourself, or other snakes.
Items: apple +10, x2, lightning, freeze, portals on some maps.
Invite: LAN Connect shows QR and URL for the same Wi-Fi. Room code is 4 letters.
AI panel (robot button): Chat, Feedback, Settings, Logs. Donate accounts come only from Feedback Hub sync.
`,
  actions: [
    { name: 'open_tab', description: 'Open AI panel tab: chat, feedback, settings, logs' },
    { name: 'show_lan', description: 'Open LAN connect screen' },
    { name: 'pause_hint', description: 'Open pause/settings during play' },
  ],
  async getContext(ctx) {
    const c = ctx || {};
    return { screen: c.screen || 'menu', room: c.code || '', score: c.score || null, mode: c.mode || '' };
  },
  async executeAction(action) {
    const name = String(action && action.name || '');
    if (!ALLOWED.has(name)) return { ok: false, error: 'Action not allowed' };
    return { ok: true, action: name, value: (action.args && action.args.value) || '', client_execute: true };
  },
  async localReply(message, live) {
    const m = String(message || '').toLowerCase();
    if (/cách chơi|hướng dẫn|help|how to|điều khiển/.test(m)) return 'PC: mũi tên hoặc WASD. Điện thoại: vuốt hoặc pad. Ăn táo, tránh tường và rắn khác. Tạo phòng rồi chia mã/QR.';
    if (/mode|chế độ|coop|survival|campaign/.test(m)) return 'Co-op chung mạng, Survival sống sót, Time Attack 90 giây, Campaign map có chướng ngại.';
    if (/lan|wifi|qr|mời/.test(m)) return 'Mở LAN Connect để lấy link/QR. Người chơi cùng Wi-Fi mở link đó.';
    if (/feedback|góp ý|donate|ủng hộ/.test(m)) return 'Tab Feedback trong nút robot: gửi bug/ý tưởng. Tài khoản ủng hộ lấy từ Feedback Hub, không hard-code.';
    if (/setting|api key|provider/.test(m)) return 'Tab Settings: chọn OpenAI, Gemini, DeepSeek, Anthropic, OpenRouter, Groq, Mistral, xAI, Custom hoặc Local. Custom/Local cần Base URL. Save.';
    if (/điểm|score|phòng|lịch sử/.test(m)) return 'Phòng: ' + (live && live.room ? live.room : '(chưa vào)') + (live && live.score != null ? ' · điểm ' + live.score : '') + '.';
    return 'Mình là hướng dẫn viên Snake Classic. Hỏi cách chơi, chế độ, LAN, điểm, feedback hoặc Settings. Chưa có API key thì phần này vẫn trả lời.';
  },
};
module.exports = adapter;
