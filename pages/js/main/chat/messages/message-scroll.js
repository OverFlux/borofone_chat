// ==========================================
// SCROLL
// ==========================================

function scrollToBottom() {
    // Скроллим messagesContainer (именно на нём overflow-y: auto в CSS)
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Скролл вниз с ожиданием загрузки изображений.
 * Используется при добавлении новых сообщений с вложениями.
 */
function scrollToBottomWithImages() {
    // Находим все изображения в контейнере, которые ещё не загрузились
    const images = messagesList.querySelectorAll('img:not([data-loaded])');

    if (images.length === 0) {
        scrollToBottom();
        return;
    }

    // Помечаем изображения как ожидающие загрузки
    let pendingCount = images.length;

    images.forEach(img => {
        // Если изображение уже загружено (из кэша)
        if (img.complete) {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
            return;
        }

        // Ждём загрузки
        img.onload = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
        };

        img.onerror = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                scrollToBottom();
            }
        };
    });

    // Скроллим сразу на случай если изображения не загрузятся
    setTimeout(() => scrollToBottom(), 100);
}

/**
 * Скролл вниз при начальной загрузке сообщений.
 * Ждёт загрузки всех изображений в сообщениях.
 */
function scrollToBottomInitial() {
    const images = messagesList.querySelectorAll('img:not([data-loaded])');

    if (images.length === 0) {
        scrollToBottom();
        return;
    }

    let pendingCount = images.length;
    let scrolled = false;

    const doScroll = () => {
        if (scrolled) return;
        scrolled = true;
        scrollToBottom();
    };

    images.forEach(img => {
        if (img.complete) {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
            return;
        }

        img.onload = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
        };

        img.onerror = () => {
            img.dataset.loaded = 'true';
            pendingCount--;
            if (pendingCount === 0) {
                doScroll();
            }
        };
    });

    // Fallback: скроллим через небольшую задержку
    setTimeout(() => doScroll(), 150);
}

function resetScroll() {
    scrollToBottom();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeMarkdownUrl(rawUrl, { allowRelative = true } = {}) {
    if (typeof rawUrl !== 'string') return null;

    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (allowRelative && /^(\/|\.\/|\.\.\/)/.test(trimmed)) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed, window.location.origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

        if (allowRelative && parsed.origin === window.location.origin) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }

        return parsed.toString();
    } catch (_) {
        return null;
    }
}

/**
 * Parse markdown with escaping - processes markdown syntax BEFORE escaping HTML
 * This allows ![image](url) syntax to work correctly while still preventing XSS
 */
function parseMarkdownWithEscaping(text) {
    if (!text) return '';
    
    // First protect markdown syntax characters from escaping
    // We need to preserve: ![](), [](), **, __, ~~, `, #, >, -, *
    let protected = text;
    
    // Protect markdown image syntax ![alt](url) - temporarily replace
    const imageMatches = [];
    protected = protected.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const placeholder = `__MD_IMAGE_${imageMatches.length}__`;
        imageMatches.push({ alt, url, original: match });
        return placeholder;
    });
    
    // Protect markdown link syntax [text](url)
    const linkMatches = [];
    protected = protected.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const placeholder = `__MD_LINK_${linkMatches.length}__`;
        linkMatches.push({ text, url, original: match });
        return placeholder;
    });
    
    // Escape HTML in the remaining text
    let escaped = escapeHtml(protected);
    
    // Restore markdown images
    imageMatches.forEach((item, index) => {
        const placeholder = `__MD_IMAGE_${index}__`;
        const safeUrl = sanitizeMarkdownUrl(item.url);
        const replacement = safeUrl
            ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(item.alt)}" class="md-image" loading="lazy">`
            : escapeHtml(item.original);
        escaped = escaped.replace(placeholder, replacement);
    });
    
    // Restore markdown links
    linkMatches.forEach((item, index) => {
        const placeholder = `__MD_LINK_${index}__`;
        const safeUrl = sanitizeMarkdownUrl(item.url);
        const replacement = safeUrl
            ? `<a href="${escapeHtml(safeUrl)}" class="md-link" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a>`
            : escapeHtml(item.text);
        escaped = escaped.replace(placeholder, replacement);
    });
    
    // Now process the rest of markdown (bold, italic, etc.) - these are already safe since we escaped HTML first
    let html = escaped;
    
    // Process shortcodes like !troll, !hello, etc. to images
    // Only match shortcodes at start of line/after whitespace, followed by whitespace or end
    html = html.replace(/(^|\s)!([a-zA-Z0-9_-]+)(?=\s|$)/g, (match, prefix, shortcode) => {
        // Check if this shortcode matches any known media
        const exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
        for (const ext of exts) {
            const filename = shortcode + ext;
            // Check in emoji folder
            if (customEmojis.includes(filename)) {
                return prefix + `<img src="/emoji/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
            // Check in stickers folder
            if (stickers.includes(filename)) {
                return prefix + `<img src="/stickers/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
            // Check in gifs folder
            if (gifs.includes(filename)) {
                return prefix + `<img src="/gifs/${escapeHtml(filename)}" alt="${escapeHtml(shortcode)}" class="md-image" loading="lazy">`;
            }
        }
        // If no match, return original text
        return match;
    });
    
    // Code blocks (```code```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block"><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Headers (### H3, ## H2, # H1)
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    
    // Blockquotes (> quote)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
    
    // Unordered lists (- item or * item)
    html = html.replace(/^[*-] (.+)$/gm, '<li class="md-li">$1</li>');
    
    // Auto-link URLs (http:// or https://)
    // This regex matches URLs that are not already inside markdown link syntax
    html = html.replace(/(<a[^>]*>[^<]*<\/a>)|(https?:\/\/[^\s<]+)/g, (match, markdownLink, plainUrl) => {
        if (markdownLink) return markdownLink;

        const safeUrl = sanitizeMarkdownUrl(plainUrl, { allowRelative: false });
        if (!safeUrl) return escapeHtml(plainUrl);

        return `<a href="${escapeHtml(safeUrl)}" class="md-link" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`;
    });
    
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

/**
 * Parse markdown syntax to HTML
 * NOTE: This function should be called AFTER escapeHtml to prevent XSS
 * Supports: bold, italic, strikethrough, inline code, code blocks, links, headers, lists, blockquotes
 */
function parseMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    
    // First, process markdown images ![alt](url) - must be before shortcodes to avoid conflicts
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const safeUrl = sanitizeMarkdownUrl(url);
        if (!safeUrl) return escapeHtml(match);
        return `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt)}" class="md-image" loading="lazy">`;
    });
    
    // Then, process shortcodes like !troll, !hello, etc. to images
    // Only match shortcodes at start of line/after whitespace, followed by whitespace or end
    html = html.replace(/(^|\s)!([a-zA-Z0-9_-]+)(?=\s|$)/g, (match, prefix, shortcode) => {
        // Check if this shortcode matches any known media
        const exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
        for (const ext of exts) {
            const filename = shortcode + ext;
            // Check in emoji folder
            if (customEmojis.includes(filename)) {
                return prefix + `<img src="/emoji/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
            // Check in stickers folder
            if (stickers.includes(filename)) {
                return prefix + `<img src="/stickers/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
            // Check in gifs folder
            if (gifs.includes(filename)) {
                return prefix + `<img src="/gifs/${filename}" alt="${shortcode}" class="md-image" loading="lazy">`;
            }
        }
        // If no match, return original text
        return match;
    });
    
    // Code blocks (```code```) - must be first to avoid conflicts
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block"><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Headers (### H3, ## H2, # H1)
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    
    // Blockquotes (> quote)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
    
    // Unordered lists (- item or * item)
    html = html.replace(/^[*-] (.+)$/gm, '<li class="md-li">$1</li>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, textValue, url) => {
        const safeUrl = sanitizeMarkdownUrl(url);
        if (!safeUrl) return escapeHtml(textValue);
        return `<a href="${escapeHtml(safeUrl)}" class="md-link" target="_blank" rel="noopener noreferrer">${escapeHtml(textValue)}</a>`;
    });
    
    // Auto-link URLs (http:// or https://)
    // This regex matches URLs that are not already inside markdown link syntax
    html = html.replace(/(<a[^>]*>[^<]*<\/a>)|(https?:\/\/[^\s<]+)/g, (match, markdownLink, plainUrl) => {
        if (markdownLink) return markdownLink;

        const safeUrl = sanitizeMarkdownUrl(plainUrl, { allowRelative: false });
        if (!safeUrl) return escapeHtml(plainUrl);

        return `<a href="${escapeHtml(safeUrl)}" class="md-link" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`;
    });
    
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}
