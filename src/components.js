// Small DOM primitive shared by the standalone authoring UI.
export const el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild }
