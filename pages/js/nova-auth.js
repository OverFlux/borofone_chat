const runtime = window.__BOROFONE_RUNTIME_CONFIG__ || {};
const API_URL = (runtime.apiUrl || window.location.origin).replace(/\/$/, "");
const MAIN_URL = runtime.routes?.main || "/main.html";
const storedTheme = localStorage.getItem("borotalk-theme");
document.documentElement.dataset.theme = storedTheme
    || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    document.documentElement.dataset.theme === "light" ? "#eceee9" : "#242424",
);
const mode = document.body.dataset.authMode;
const form = document.getElementById("authForm");
const errorText = document.getElementById("errorText");
const demoButton = document.getElementById("demoButton");

function detailFrom(payload, fallback) {
    if (typeof payload?.detail === "string") return payload.detail;
    if (Array.isArray(payload?.detail)) return payload.detail[0]?.msg || fallback;
    return fallback;
}

async function submitAuth(event) {
    event.preventDefault();
    errorText.textContent = "";
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const payload = mode === "register"
        ? {
            email: document.getElementById("email").value.trim(),
            username: document.getElementById("username").value.trim(),
            display_name: document.getElementById("displayName").value.trim(),
            password: document.getElementById("password").value,
            invite_code: document.getElementById("inviteCode").value.trim(),
        }
        : {
            email: document.getElementById("email").value.trim(),
            password: document.getElementById("password").value,
        };
    try {
        const response = await fetch(`${API_URL}/auth/${mode}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(detailFrom(result, "Не удалось продолжить"));
        window.location.href = MAIN_URL;
    } catch (error) {
        errorText.textContent = error.message || "Ошибка сети";
        submit.disabled = false;
    }
}

async function openDemo() {
    errorText.textContent = "";
    demoButton.disabled = true;
    try {
        const response = await fetch(`${API_URL}/auth/demo`, {
            method: "POST",
            credentials: "include",
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(detailFrom(result, "Демо недоступно"));
        window.location.href = MAIN_URL;
    } catch (error) {
        errorText.textContent = error.message || "Ошибка сети";
        demoButton.disabled = false;
    }
}

form.addEventListener("submit", submitAuth);
demoButton?.addEventListener("click", openDemo);
