import { el } from './dom.js';

export function Button({ text, className = "btn-primary", onClick, iconSvg, ...props }) {
    const children = [];
    if (iconSvg) {
        const iconContainer = document.createElement("span");
        iconContainer.innerHTML = iconSvg; // Safe here as it's static developer-defined SVG strings, not user data
        children.push(iconContainer.firstChild);
    }
    if (text) children.push(document.createTextNode(text));

    return el("button", { class: className, onclick: onClick, ...props }, ...children);
}

export function Pill({ text, className = "bg-bone text-muted" }) {
    return el("span", { class: `badge-pill ${className}`, text });
}

export function Card({ className = "card", ...props }, ...children) {
    return el("article", { class: className, ...props }, ...children);
}

export function StatusBanner({ text, isOnline }) {
    return el("div", {
        class: isOnline ? "status-online" : "status-offline",
        role: "status",
        "aria-live": "polite",
        text
    });
}