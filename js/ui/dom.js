export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);

    for (const Object.entries(props).forEach(([key, val]) => {
        if (key === "className" || key === "class") {
            node.className = val;
        } else if (key === "textContent" || key === "text") {
            node.textContent = val;
        } else if (key.startsWith("on") && typeof val === "function") {
            node.addEventListener(key.substring(2).toLowerCase(), val);
        } else if (val !== null && val !== undefined) {
            node.setAttribute(key, val);
        }
    });

        children.flat().forEach(child => {
            if (child === null || child === undefined || child === false) return;
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });

    return node;
}