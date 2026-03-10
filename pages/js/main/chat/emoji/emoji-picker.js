// ==========================================
// EMOJI PICKER DATA
// ==========================================

const EMOJI_CATEGORIES = {
    custom: {
        name: 'Кастомные',
        emojis: [],
        isCustom: true,
        path: '/emoji/'
    },
    smileys: {
        name: 'Улыбки и эмоции',
        emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖']
    },
    animals: {
        name: 'Животные и природа',
        emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔']
    },
    food: {
        name: 'Еда и напитки',
        emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊']
    },
    activities: {
        name: 'Активность и спорт',
        emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚴', '🚵', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🪈', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩', '🎠', '🎡', '🎢', '💎', '🎪', '🎫', '🎟️', '🎫']
    },
    travel: {
        name: 'Путешествия и места',
        emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️']
    },
    objects: {
        name: 'Предметы',
        emojis: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🪆', '🖼️', '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓']
    },
    symbols: {
        name: 'Символы',
        emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧']
    },
    flags: {
        name: 'Флаги',
        emojis: ['🏳️', '🏴', '🏴‍☠️', '🏁', '🚩', '🎌', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇺🇸', '🇬🇧', '🇷🇺', '🇺🇦', '🇧🇾', '🇰🇿', '🇪🇸', '🇫🇷', '🇩🇪', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇲🇽', '🇨🇦', '🇦🇺', '🇳🇱', '🇵🇱', '🇨🇭', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇵🇹', '🇬🇷', '🇹🇷', '🇿🇦', '🇪🇬', '🇮🇱', '🇸🇦', '🇦🇪', '🇹🇭', '🇻🇳', '🇮🇩', '🇵🇭', '🇲🇾', '🇸🇬', '🇳🇵', '🇱🇰', '🇧🇩', '🇵🇰', '🇮🇷', '🇮🇶', '🇰🇼', '🇶🇦', '🇧🇭', '🇴🇲', '🇾🇪', '🇸🇾', '🇱🇧', '🇸🇩', '🇸🇸', '🇪🇹', '🇪🇷', '🇩🇯', '🇰🇪', '🇹🇿', '🇺🇬', '🇷🇼', '🇧🇮', '🇪🇿', '🇳🇪', '🇸🇳', '🇬🇳', '🇸🇱', '🇱🇷', '🇨🇮', '🇬🇭', '🇳🇬', '🇬🇲', '🇬🇦', '🇸🇿', '🇱🇸', '🇧🇼', '🇳🇦', '🇲🇿', '🇿🇦', '🇱🇽', '🇲🇬', '🇲🇱', '🇨🇲', '🇨🇫', '🇹🇩', '🇨🇬', '🇨🇩', '🇷🇬', '🇦🇴', '🇿🇲', '🇲🇼', '🇲🇦', '🇩🇿', '🇱🇾', '🇹🇳', '🇲🇹', '🇨🇾', '🇭🇷', '🇷🇸', '🇸🇮', '🇲🇪', '🇧🇦', '🇲🇰', '🇦🇱', '🇲🇩', '🇺🇦', '🇪🇪', '🇱🇻', '🇱🇹', '🇱🇺', '🇧🇪', '🇳🇱', '🇱🇺', '🇭🇺', '🇦🇹', '🇨🇿', '🇸🇰', '🇮🇪', '🇬🇮', '🇻🇦', '🇸🇲', '🇦🇩', '🇲🇨', '🇲🇦', '🇯🇪', '🇬🇪', '🇦🇲', '🇦🇿', '🇬🇪', '🇰🇬', '🇹🇯', '🇹🇲', '🇺🇿', '🇦🇫', '🇦🇱', '🇧🇹', '🇧🇳', '🇰🇭', '🇱🇦', '🇲🇲', '🇲🇳', '🇲🇬', '🇵🇬', '🇸🇧', '🇻🇺', '🇼🇸', '🇲🇵', '🇬🇺', '🇵🇫', '🇵🇳', '🇳🇷', '🇳🇫', '🇹🇰', '🇸🇭', '🇲🇶', '🇬🇵', '🇩🇬', '🇦🇬', '🇦🇮', '🇧🇧', '🇨🇼', '🇨🇩', '🇨🇬', '🇩🇲', '🇬🇩', '🇭🇹', '🇯🇲', '🇰🇳', '🇱🇨', '🇲🇫', '🇲🇸', '🇳🇵', '🇰🇷', '🇵🇲', '🇸🇭', '🇸🇨', '🇸🇩', '🇸🇸', '🇸🇹', '🇹🇨', '🇹🇩', '🇹🇬', '🇹🇹', '🇹🇻', '🇻🇬', '🇻🇮']
    }
};

// Emoji picker state
let activeEmojiCategory = 'custom';
let emojiPicker = null;
let emojiBtn = null;
let emojiGrid = null;

function initEmojiPicker() {
    emojiPicker = document.getElementById('emojiPicker');
    emojiBtn = document.getElementById('emojiBtn');
    emojiGrid = document.getElementById('emojiGrid');

    if (!emojiPicker || !emojiBtn || !emojiGrid) {
        console.warn('[emoji] Elements not found');
        return;
    }

    // Toggle emoji picker on button click
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEmojiPicker();
    });

    // Close picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
            closeEmojiPicker();
        }
    });

    // Tab switching (Эмодзи, Стикеры, Гифки)
    const tabBtns = emojiPicker.querySelectorAll('.emoji-tab');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tab = btn.dataset.tab;
            
            // Hide all content sections
            const contents = emojiPicker.querySelectorAll('.emoji-content');
            contents.forEach(c => c.classList.add('hidden'));
            
            // Show selected content
            if (tab === 'emoji') {
                document.getElementById('emojiContent').classList.remove('hidden');
            } else if (tab === 'stickers') {
                document.getElementById('stickersContent').classList.remove('hidden');
                // Load stickers if not loaded
                if (stickers.length === 0) {
                    loadStickers();
                }
            } else if (tab === 'gifs') {
                document.getElementById('gifsContent').classList.remove('hidden');
                // Load gifs if not loaded
                if (gifs.length === 0) {
                    loadGifs();
                }
            }
        });
    });

    // Category buttons within emoji tab
    const categoryBtns = emojiPicker.querySelectorAll('.emoji-category-btn');
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeEmojiCategory = btn.dataset.category;
            renderEmojis(activeEmojiCategory);
        });
    });

    // Initial render
    renderEmojis('custom');
    
    // Load all media for shortcode support and emoji picker
    loadAllMedia();
}

// Load all media (emoji, stickers, gifs) at once
async function loadAllMedia() {
    try {
        const response = await fetch('/api/media?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            
            if (data.emojis && data.emojis.length > 0) {
                customEmojis = data.emojis;
                console.log('[media] Emojis loaded:', customEmojis.length);
                // Render if on custom emoji category
                if (activeEmojiCategory === 'custom') {
                    renderCustomEmojis();
                }
            }
            
            if (data.stickers && data.stickers.length > 0) {
                stickers = data.stickers;
                console.log('[media] Stickers loaded:', stickers.length);
                renderStickers();
            }
            
            if (data.gifs && data.gifs.length > 0) {
                gifs = data.gifs;
                console.log('[media] GIFs loaded:', gifs.length);
                renderGifs();
            }
            
            console.log('[media] All media loaded');
        }
    } catch (err) {
        console.warn('[media] Could not load media:', err);
        // Fallback to individual loads
        loadCustomEmojis();
        loadStickers();
        loadGifs();
    }
}

function toggleEmojiPicker() {
    if (emojiPicker.classList.contains('hidden')) {
        openEmojiPicker();
    } else {
        closeEmojiPicker();
    }
}

function openEmojiPicker() {
    emojiPicker.classList.remove('hidden');
    
    // Reset tab to emoji
    const tabBtns = emojiPicker.querySelectorAll('.emoji-tab');
    tabBtns.forEach(b => b.classList.remove('active'));
    const emojiTab = emojiPicker.querySelector('[data-tab="emoji"]');
    if (emojiTab) emojiTab.classList.add('active');
    
    // Show emoji content, hide others
    const contents = emojiPicker.querySelectorAll('.emoji-content');
    contents.forEach(c => c.classList.add('hidden'));
    document.getElementById('emojiContent').classList.remove('hidden');
    
    // Reset category
    const activeBtn = emojiPicker.querySelector('.emoji-category-btn.active');
    if (activeBtn) {
        activeBtn.classList.remove('active');
    }
    const defaultBtn = emojiPicker.querySelector('[data-category="custom"]');
    if (defaultBtn) defaultBtn.classList.add('active');
    activeEmojiCategory = 'custom';
    renderEmojis('custom');
}

function closeEmojiPicker() {
    emojiPicker.classList.add('hidden');
}

// Custom emoji files cache
let customEmojis = ['Anime.gif']; // Default, will be loaded from server
let stickers = []; // Stickers cache
let gifs = []; // GIFs cache

// Load custom emojis from server
async function loadCustomEmojis() {
    try {
        // Add timestamp to prevent caching
        const response = await fetch('/api/emoji?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.emojis && data.emojis.length > 0) {
                customEmojis = data.emojis;
                console.log('[emoji] Custom emojis loaded:', customEmojis.length);
                // Always re-render when emojis are loaded
                renderCustomEmojis();
            }
        }
    } catch (err) {
        console.warn('[emoji] Could not load custom emojis:', err);
    }
}

// Load stickers from server
async function loadStickers() {
    const stickersGrid = document.getElementById('stickersGrid');
    if (!stickersGrid) {
        console.warn('[stickers] Stickers grid not found in DOM');
        return;
    }
    
    stickersGrid.innerHTML = '<div class="emoji-loading">Загрузка стикеров...</div>';
    
    try {
        const response = await fetch('/api/stickers?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.stickers && data.stickers.length > 0) {
                stickers = data.stickers;
                console.log('[stickers] Stickers loaded:', stickers.length);
                renderStickers();
            } else {
                stickersGrid.innerHTML = '<div class="emoji-empty">Нет доступных стикеров</div>';
            }
        } else {
            stickersGrid.innerHTML = '<div class="emoji-empty">Не удалось загрузить стикеры</div>';
        }
    } catch (err) {
        console.warn('[stickers] Could not load stickers:', err);
        stickersGrid.innerHTML = '<div class="emoji-empty">Ошибка загрузки стикеров</div>';
    }
}

// Render stickers in the grid
function renderStickers() {
    const stickersGrid = document.getElementById('stickersGrid');
    if (!stickersGrid) return;
    
    if (stickers.length === 0) {
        stickersGrid.innerHTML = '<div class="emoji-empty">Нет доступных стикеров</div>';
        return;
    }
    
    stickersGrid.innerHTML = '';
    
    stickers.forEach(stickerFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-item';
        btn.title = stickerFile.replace(/\.(png|jpg|gif|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/stickers/' + stickerFile;
        img.alt = stickerFile;
        img.loading = 'lazy';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertSticker('/stickers/' + stickerFile, stickerFile, true));
        stickersGrid.appendChild(btn);
    });
}

// Insert sticker into message input
function insertSticker(stickerUrl, stickerName, autoSend = false) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    // Insert sticker as markdown image tag
    const name = stickerName.replace(/\.(png|jpg|gif|webp)$/i, '');
    const stickerMarkdown = `![${name}](${stickerUrl})`;
    
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    
    messageInput.value = text.substring(0, start) + stickerMarkdown + text.substring(end);
    
    // Move cursor after sticker
    const newPos = start + stickerMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();
    
    closeEmojiPicker();
    
    // Auto-send if requested
    if (autoSend) {
        sendMessage();
    }
}

// Load GIFs from server
async function loadGifs() {
    const gifsGrid = document.getElementById('gifsGrid');
    if (!gifsGrid) {
        console.warn('[gifs] GIFs grid not found in DOM');
        return;
    }
    
    gifsGrid.innerHTML = '<div class="emoji-loading">Загрузка гифок...</div>';
    
    try {
        const response = await fetch('/api/gifs?_=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.gifs && data.gifs.length > 0) {
                gifs = data.gifs;
                console.log('[gifs] GIFs loaded:', gifs.length);
                renderGifs();
            } else {
                gifsGrid.innerHTML = '<div class="emoji-empty">Нет доступных гифок</div>';
            }
        } else {
            gifsGrid.innerHTML = '<div class="emoji-empty">Не удалось загрузить гифки</div>';
        }
    } catch (err) {
        console.warn('[gifs] Could not load gifs:', err);
        gifsGrid.innerHTML = '<div class="emoji-empty">Ошибка загрузки гифок</div>';
    }
}

// Render GIFs in the grid
function renderGifs() {
    const gifsGrid = document.getElementById('gifsGrid');
    if (!gifsGrid) return;
    
    if (gifs.length === 0) {
        gifsGrid.innerHTML = '<div class="emoji-empty">Нет доступных гифок</div>';
        return;
    }
    
    gifsGrid.innerHTML = '';
    
    gifs.forEach(gifFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gif-item';
        btn.title = gifFile.replace(/\.(gif|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/gifs/' + gifFile;
        img.alt = gifFile;
        img.loading = 'lazy';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertGif('/gifs/' + gifFile, gifFile, true));
        gifsGrid.appendChild(btn);
    });
}

// Insert GIF into message input
function insertGif(gifUrl, gifName, autoSend = false) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    // Insert GIF as markdown image tag
    const name = gifName.replace(/\.(gif|webp)$/i, '');
    const gifMarkdown = `![${name}](${gifUrl})`;
    
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    
    messageInput.value = text.substring(0, start) + gifMarkdown + text.substring(end);
    
    // Move cursor after GIF
    const newPos = start + gifMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();
    
    closeEmojiPicker();
    
    // Auto-send if requested
    if (autoSend) {
        sendMessage();
    }
}

function renderEmojis(category) {
    if (!emojiGrid || !EMOJI_CATEGORIES[category]) return;

    const cat = EMOJI_CATEGORIES[category];
    
    // Handle custom emoji category (GIFs)
    if (cat.isCustom) {
        renderCustomEmojis();
        return;
    }

    const emojis = cat.emojis;
    emojiGrid.innerHTML = '';

    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-item';
        btn.textContent = emoji;
        btn.addEventListener('click', () => insertEmoji(emoji));
        emojiGrid.appendChild(btn);
    });
}

function renderCustomEmojis() {
    emojiGrid.innerHTML = '';
    
    if (customEmojis.length === 0) {
        emojiGrid.innerHTML = '<div class="emoji-no-custom">Загрузка кастомных эмодзи...</div>';
        loadCustomEmojis();  // Trigger load if empty
        return;
    }

    customEmojis.forEach(emojiFile => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-item custom-emoji-item';
        // Remove any image extension from the title
        btn.title = emojiFile.replace(/\.(gif|png|jpg|jpeg|webp)$/i, '');
        
        const img = document.createElement('img');
        img.src = '/emoji/' + emojiFile;
        img.alt = emojiFile;
        img.className = 'custom-emoji-img';
        
        btn.appendChild(img);
        btn.addEventListener('click', () => insertCustomEmoji('/emoji/' + emojiFile));
        emojiGrid.appendChild(btn);
    });
}

function insertCustomEmoji(emojiUrl) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    // Insert custom emoji as markdown image tag (like Discord)
    const emojiName = emojiUrl.split('/').pop().replace('.gif', '');
    const emojiMarkdown = `![${emojiName}](${emojiUrl})`;
    
    // Insert at cursor position
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;

    messageInput.value = text.substring(0, start) + emojiMarkdown + text.substring(end);

    // Move cursor after emoji
    const newPos = start + emojiMarkdown.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();

    // Close picker after selection
    closeEmojiPicker();

    // Trigger input event to update UI
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertEmoji(emoji) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    // Insert emoji at cursor position
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;

    messageInput.value = text.substring(0, start) + emoji + text.substring(end);

    // Move cursor after emoji
    const newPos = start + emoji.length;
    messageInput.setSelectionRange(newPos, newPos);
    messageInput.focus();

    // Close picker after selection
    closeEmojiPicker();

    // Trigger input event to update UI
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
}

let voiceRooms = [];
let currentVoiceRoomId = null;
let voiceParticipants = [];

// Typing indicator state
const TYPING_TIMEOUT_MS = 3000;  // Time before stopping typing indicator
const TYPING_DEBOUNCE_MS = 500;  // Debounce time between typing events
let typingTimeout = null;
let typingUsers = {};  // { userId: timeout }
let localStream = null;
let isMuted = false;
let isDeafened = false;
const peerConnections = new Map();
const voiceRoomParticipantsByRoom = {};

const voiceJoinSound = new Audio('./sounds/voice_join.wav');
const voiceLeaveSound = new Audio('./sounds/voice_leave.wav');
const streamStartSound = new Audio('./sounds/stream_start.wav');
const streamEndSound = new Audio('./sounds/stream_end.wav');
voiceJoinSound.preload = 'none';
voiceLeaveSound.preload = 'none';
streamStartSound.preload = 'none';
streamEndSound.preload = 'none';

// Profile message button sound
const profileMessageSound = new Audio('./sounds/net-idi-na.mp3');
profileMessageSound.preload = 'none';

const participantVolumes = JSON.parse(localStorage.getItem('participantVolumes') || "{}");
let micGainValue = 1;
let headphonesGainValue = 2;
let micAudioContext = null;
let micGainNode = null;
let processedOutboundStream = null;

// Web Audio GainNodes for remote participants (allows gain > 1.0 unlike audio.volume)
const remoteAudioGainNodes = new Map(); // userId -> { audioCtx, gainNode }

let localScreenStream = null;
let pendingScreenStream = null;
let isScreenShareStopping = false;
let activeScreenViewerUserId = null;
const remoteScreenStreams = new Map();
const remoteAudioStreams = new Map();
const localScreenSenders = new Map();
const popoutWindows = new Map();
const peerRenegotiationLocks = new Set();
