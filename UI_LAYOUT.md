# Bố trí icon AI & panel (chuẩn Snake Arcade)

## Vị trí nút AI (FAB)

- **Góc dưới phải** màn hình, `position: fixed`
- Cách mép: ~16–20px; tôn trọng `safe-area-inset` trên mobile
- `z-index: 410` (cao hơn chrome game, thấp hơn hoặc bằng overlay panel tùy host)
- **Không** đặt trong header/menu chính nếu sẽ bị scroll mất
- Một nút duy nhất — không nhân đôi FAB

```html
<button type="button" class="ai-fab" id="aiFab" title="AI · Feedback · Settings" aria-label="AI">
  <img src="/ai-icon.png" alt="AI" class="ai-fab-img">
  <span class="ai-fab-dot" id="aiStatusDot"></span>
  <span class="ai-badge" id="aiBadge" hidden style="display:none"></span>
</button>
```

Copy `assets/ai-icon.png` → `public/ai-icon.png`.

## Trạng thái chấm (dot)

- Xanh (`on`): AI đã cấu hình key
- Đỏ/xám (`off`): chỉ local guide

## Khi mở panel

1. Hiện `#aiOverlay` (full-screen dim)
2. **Ẩn** `#aiFab` để không đè nút đóng panel
3. Khi đóng (× hoặc bấm nền) → hiện lại FAB

## Panel

- Bottom sheet trên mobile (`align-items: flex-end`); center trên desktop rộng
- Tabs cố định: **Chat | Feedback | Settings | Logs**
- `z-index` overlay ~400

## CSS / HTML mẫu

- `example/ui/ai-panel.css` — styles đã dùng production
- `example/ui/ai-panel.html` — markup FAB + panel
- `example/ui/ai-panel.js` — controller đầy đủ (badge, settings, feedback, logs)

Host chỉ cần:

```html
<link rel="stylesheet" href="ai-panel.css"> <!-- hoặc merge vào style.css -->
…
<script src="/ai-module/ai-module.js"></script>
<script src="/feedback-module/feedback-module.js"></script>
<script src="/ai-panel.js"></script>
```

## Không phá UI app

- FAB là **cộng thêm** một control fixed
- Không đổi layout màn hình chính, menu, canvas
