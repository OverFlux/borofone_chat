const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const formatterUrl = pathToFileURL(
  path.join(__dirname, "..", "..", "pages", "js", "message-format.mjs"),
).href;

test("turns HTTPS and www addresses into safe chat links", async () => {
  const { formatMessageBody } = await import(formatterUrl);
  const html = formatMessageBody("Смотри https://example.com/a?x=1&y=2 и www.example.org.");

  assert.match(
    html,
    /href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(html, /href="https:\/\/www\.example\.org\/"/);
  assert.match(html, /www\.example\.org<\/a>\.$/);
});

test("keeps punctuation outside links and escapes arbitrary HTML", async () => {
  const { formatMessageBody } = await import(formatterUrl);
  const html = formatMessageBody('<b>нет</b> (https://example.com/path). javascript:alert(1)');

  assert.match(html, /^&lt;b&gt;нет&lt;\/b&gt; \(/);
  assert.match(html, /https:\/\/example\.com\/path<\/a>\)\./);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("keeps custom emoji rendering alongside links", async () => {
  const { formatMessageBody } = await import(formatterUrl);
  const html = formatMessageBody("https://example.com ![Roflan](/emoji/rofl.png)");

  assert.match(html, /class="message-link"/);
  assert.match(html, /class="custom-emoji" src="\/emoji\/rofl\.png"/);
});
