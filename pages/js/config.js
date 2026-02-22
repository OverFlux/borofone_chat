// Определяем где мы — локально или через tunnel
const isLocalTunnel = window.location.hostname.includes('loca.lt');

// API URL - всегда используем текущий origin чтобы cookies работали
const API_URL = window.location.origin;

// WebSocket URL
const WS_URL = API_URL.replace(/^http/, 'ws');

console.log('API URL:', API_URL);
console.log('WS URL:', WS_URL);