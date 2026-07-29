const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":"]);
const CLOSING_BRACKETS = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
]);

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function splitTrailingPunctuation(candidate) {
    let end = candidate.length;

    while (end > 0) {
        const lastCharacter = candidate[end - 1];
        if (TRAILING_PUNCTUATION.has(lastCharacter)) {
            end -= 1;
            continue;
        }

        const openingBracket = CLOSING_BRACKETS.get(lastCharacter);
        if (!openingBracket) break;

        const urlPart = candidate.slice(0, end);
        const openingCount = [...urlPart].filter((character) => character === openingBracket).length;
        const closingCount = [...urlPart].filter((character) => character === lastCharacter).length;
        if (closingCount <= openingCount) break;
        end -= 1;
    }

    return {
        url: candidate.slice(0, end),
        trailing: candidate.slice(end),
    };
}

function linkifyText(value) {
    const source = String(value ?? "");
    let html = "";
    let cursor = 0;
    let match;

    while ((match = URL_PATTERN.exec(source)) !== null) {
        const previousCharacter = source[match.index - 1] || "";
        if (/[A-Za-z0-9_@]/.test(previousCharacter)) continue;

        const candidate = match[0];
        const { url, trailing } = splitTrailingPunctuation(candidate);
        const hrefSource = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;

        let href;
        try {
            const parsed = new URL(hrefSource);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
            href = parsed.href;
        } catch {
            continue;
        }

        html += escapeHtml(source.slice(cursor, match.index));
        html += `<a class="message-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
        html += escapeHtml(trailing);
        cursor = match.index + candidate.length;
    }

    return html + escapeHtml(source.slice(cursor));
}

export function formatMessageBody(body) {
    const source = String(body ?? "");
    const emojiPattern = /!\[([^\]]*)\]\(\/emoji\/([A-Za-z0-9_.-]+)\)/g;
    let html = "";
    let cursor = 0;
    let match;

    while ((match = emojiPattern.exec(source)) !== null) {
        html += linkifyText(source.slice(cursor, match.index));
        const filename = match[2];
        html += `<img class="custom-emoji" src="/emoji/${encodeURIComponent(filename)}" alt="${escapeHtml(match[1] || filename)}" loading="lazy">`;
        cursor = match.index + match[0].length;
    }

    return html + linkifyText(source.slice(cursor));
}
