// SPDX-License-Identifier: GPL-3.0-or-later
import { objectTokenQuery, filterObjectTokens } from "./object-tokens.js";

let nextId = 0;

// Attach only to explicitly chosen fields. No global text input is intercepted.
export function attachObjectCompletion(input, getOptions, { chinese = true } = {}) {
    const abort = new AbortController();
    const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: abort.signal });
    const popup = document.createElement("div");
    popup.className = "cb-object-completions";
    popup.id = `cb-object-completions-${++nextId}`;
    popup.setAttribute("popover", "manual");
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", chinese ? "边界框引用" : "Bounding box references");
    document.body.append(popup);
    const previousAria = new Map(["aria-autocomplete", "aria-controls", "aria-expanded", "aria-activedescendant"].map(key => [key, input.getAttribute(key)]));
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", popup.id);
    input.setAttribute("aria-expanded", "false");
    let matches = [], range = null, active = 0, composing = false, frame = 0, timer = 0, dismissed = "", signature = "", querySnapshot = "", caret = null;
    const snapshot = () => `${input.value}\u0000${input.selectionStart}:${input.selectionEnd}`;
    const isOpen = () => popup.matches(":popover-open");

    function close(dismiss = false) {
        if (dismiss) dismissed = snapshot();
        cancelAnimationFrame(frame);
        clearInterval(timer);
        frame = timer = 0;
        if (isOpen()) popup.hidePopover();
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }

    function measureCaret() {
        const mirror = document.createElement("div");
        const style = getComputedStyle(input);
        for (const key of ["boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "tabSize"]) mirror.style[key] = style[key];
        Object.assign(mirror.style, { position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none", width: `${input.offsetWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word" });
        mirror.textContent = input.value.slice(0, input.selectionStart);
        const marker = document.createElement("span");
        marker.textContent = input.value.slice(input.selectionStart) || "\u200b";
        mirror.append(marker);
        document.body.append(mirror);
        caret = { x: marker.offsetLeft, y: marker.offsetTop, line: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4, width: input.offsetWidth };
        mirror.remove();
    }

    function position() {
        const rect = input.getBoundingClientRect();
        if (!rect.width || !rect.height) { close(); return; }
        if (!caret || caret.width !== input.offsetWidth) measureCaret();
        const scale = rect.width / (input.offsetWidth || 1);
        popup.style.fontSize = `${Math.max(11, Math.min(16, parseFloat(getComputedStyle(input).fontSize) * scale))}px`;
        popup.style.width = `${Math.min(420, Math.max(210, rect.width), window.innerWidth - 16)}px`;
        const x = rect.left + (caret.x - input.scrollLeft) * scale;
        const y = rect.top + (caret.y - input.scrollTop) * scale;
        popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - popup.offsetWidth - 8))}px`;
        const below = y + caret.line * scale + 3;
        popup.style.top = `${below + popup.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, y - popup.offsetHeight - 3)}px`;
    }

    function track() {
        if (!input.isConnected || document.activeElement !== input || !isOpen()) { close(); return; }
        position();
        if (isOpen()) frame = requestAnimationFrame(track);
    }

    function highlight() {
        [...popup.children].forEach((option, index) => option.setAttribute("aria-selected", String(index === active)));
        const selected = popup.children[active];
        if (selected) {
            input.setAttribute("aria-activedescendant", selected.id);
            selected.scrollIntoView({ block: "nearest" });
        }
    }

    function accept(index) {
        const query = objectTokenQuery(input.value, input.selectionStart, input.selectionEnd);
        if (!query || !range || query.start !== range.start || query.end !== range.end || query.query !== range.query) { close(); return; }
        const choice = filterObjectTokens(getOptions(), query.query)[index];
        if (!choice) { close(); return; }
        input.setSelectionRange(query.start, query.end);
        // Chromium's native insertion keeps the user's normal undo history.
        // setRangeText provides a fallback when native insertion is unavailable.
        const expected = input.value.slice(0, query.start) + choice.token + input.value.slice(query.end);
        let emitted = false;
        const onInput = () => { emitted = true; };
        input.addEventListener("input", onInput, { once: true });
        try {
            if (!document.execCommand("insertText", false, choice.token)) input.setRangeText(choice.token, query.start, query.end, "end");
        } finally { input.removeEventListener("input", onInput); }
        if (!emitted && input.value === expected) input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: choice.token }));
        close(true);
    }

    function update() {
        if (composing || !input.isConnected || document.activeElement !== input || snapshot() === dismissed) { close(); return; }
        const query = objectTokenQuery(input.value, input.selectionStart, input.selectionEnd);
        const options = query ? filterObjectTokens(getOptions(), query.query) : [];
        if (!options.length) { close(); return; }
        const nextSignature = JSON.stringify([query, options]);
        if (nextSignature !== signature) {
            const previous = querySnapshot === snapshot() ? matches[active]?.token : null;
            querySnapshot = snapshot();
            range = query; matches = options; signature = nextSignature;
            active = Math.max(0, matches.findIndex(item => item.token === previous));
            popup.replaceChildren();
            for (const [index, item] of matches.entries()) {
                const option = document.createElement("button");
                option.type = "button"; option.id = `${popup.id}-${index}`;
                option.setAttribute("role", "option"); option.tabIndex = -1;
                const token = document.createElement("span"); token.textContent = item.token;
                const label = document.createElement("span"); label.className = "cb-object-label"; label.textContent = item.label;
                option.append(token, label);
                // Keep the caret in the textarea while choosing a candidate.
                option.onpointerdown = event => { if (event.button === 0) { event.preventDefault(); event.stopPropagation(); accept(index); } };
                popup.append(option);
            }
        }
        measureCaret();
        if (!isOpen()) {
            popup.showPopover();
            position();
            frame = requestAnimationFrame(track);
            timer = setInterval(update, 200);
        }
        highlight();
    }

    listen(input, "input", event => { dismissed = ""; querySnapshot = ""; if (!event.isComposing) update(); });
    listen(input, "click", update);
    listen(input, "blur", () => close());
    listen(input, "compositionstart", () => { composing = true; close(); });
    listen(input, "compositionend", () => { composing = false; update(); });
    listen(document, "selectionchange", () => { if (document.activeElement === input) update(); });
    listen(document, "pointerdown", event => { if (event.target !== input && !popup.contains(event.target)) close(true); }, { capture: true });
    listen(input, "keydown", event => {
        if (composing || event.isComposing || event.keyCode === 229 || !isOpen() || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "Escape") close(true);
        else if (event.key === "Enter" || event.key === "Tab") accept(active);
        else { active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length; highlight(); }
    }, { capture: true });

    return { close, destroy() {
        close(); abort.abort(); popup.remove();
        for (const [key, value] of previousAria) value === null ? input.removeAttribute(key) : input.setAttribute(key, value);
    } };
}
