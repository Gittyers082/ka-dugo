// Shared DOM helpers. Every page builds its dynamic content with these instead of HTML strings.

// el('p', { class: 'note', text: 'Hi' }, child, ...) -> <p class="note">Hi</p>
// Attributes: text -> textContent, on<event> functions -> listeners, false/null -> skipped.
export function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);

    for (const [key, value] of Object.entries(attributes)) {
        if (value === false || value === null || value === undefined) continue;
        if (key === 'text') {
            element.textContent = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else {
            element.setAttribute(key, value === true ? '' : value);
        }
    }

    element.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false)
        .map((child) => (child instanceof Node ? child : String(child))));
    return element;
}

// Inline SVG icon from path data, e.g. svg('M3 12h18', 'M12 3v18').
export function svg(...paths) {
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        icon.append(path);
    }
    return icon;
}

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function setText(selector, text, scope = document) {
    const element = scope.querySelector(selector);
    if (element) element.textContent = text;
}
