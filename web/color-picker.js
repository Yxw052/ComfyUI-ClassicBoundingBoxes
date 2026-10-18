// SPDX-License-Identifier: GPL-3.0-or-later
// Classic DOM adaptation of ComfyUI_frontend's ColorPickerPanel (alpha=false).
import { hexToHsva, hsvaToHex, normalizeHex, hexToRgb, rgbToHex } from './color-utils.js';

export function openColorPicker(trigger, value, onChange, chinese = false) {
    const signal = new AbortController();
    const popup = document.createElement('div');
    popup.className = 'classic-bbox-picker';
    popup.setAttribute('popover', 'auto');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', chinese ? '调色板颜色' : 'Palette color');
    const listen = (el, name, cb, options = {}) => el.addEventListener(name, cb, { ...options, signal: signal.signal });
    const create = (tag, className, parent = popup) => {
        const el = document.createElement(tag);
        el.className = className;
        parent.append(el);
        return el;
    };
    let hsva = hexToHsva(value);
    hsva.a = 100;
    const sv = create('div', 'cb-color-sv');
    sv.setAttribute('role', 'slider');
    sv.setAttribute('aria-label', chinese ? '饱和度和亮度' : 'Saturation and brightness');
    sv.tabIndex = 0;
    const svHandle = create('span', 'cb-color-handle', sv);
    const hue = create('div', 'cb-color-hue');
    hue.setAttribute('role', 'slider');
    hue.setAttribute('aria-label', chinese ? '色相' : 'Hue');
    hue.tabIndex = 0;
    const hueHandle = create('span', 'cb-color-handle', hue);
    const row = create('div', 'cb-color-fields');
    const mode = create('select', 'cb-color-format', row);
    mode.setAttribute('aria-label', chinese ? '颜色格式' : 'Color format');
    for (const [key, label] of [['hex', chinese ? '十六进制' : 'Hex'], ['rgb', 'RGB']]) {
        const option = document.createElement('option');
        option.value = key; option.textContent = label; mode.append(option);
    }
    const fields = create('div', 'cb-color-values', row);
    const hex = create('input', '', fields);
    hex.type = 'text'; hex.spellcheck = false;
    hex.setAttribute('aria-label', chinese ? '十六进制颜色' : 'Hex color');
    const channels = ['r', 'g', 'b'].map(channel => {
        const input = create('input', '', fields);
        input.type = 'number'; input.min = '0'; input.max = '255';
        input.setAttribute('aria-label', channel.toUpperCase());
        listen(input, 'input', () => {
            if (!channels.every(c => c.value !== '' && c.validity.valid)) return;
            const next = rgbToHex(Object.fromEntries(channels.map((c, i) => [['r', 'g', 'b'][i], Number(c.value)])));
            hsva = hexToHsva(next); update(true);
        });
        return input;
    });

    function update(emit) {
        const next = hsvaToHex(hsva);
        sv.style.setProperty('--hue', String(hsva.h));
        svHandle.style.left = `${hsva.s}%`;
        svHandle.style.top = `${100 - hsva.v}%`;
        hueHandle.style.left = `${hsva.h / 3.6}%`;
        sv.setAttribute('aria-valuetext', `${Math.round(hsva.s)}%, ${Math.round(hsva.v)}%`);
        hue.setAttribute('aria-valuenow', String(Math.round(hsva.h)));
        if (document.activeElement !== hex) hex.value = next;
        const rgb = hexToRgb(next);
        channels.forEach((input, i) => { if (document.activeElement !== input) input.value = rgb[['r', 'g', 'b'][i]]; });
        hex.hidden = mode.value !== 'hex';
        channels.forEach(input => { input.hidden = mode.value !== 'rgb'; });
        if (emit) onChange(next);
    }
    listen(mode, 'change', () => update(false));
    listen(hex, 'input', () => {
        const next = normalizeHex(hex.value);
        if (next) { hsva = hexToHsva(next); update(true); }
    });
    listen(hex, 'blur', () => { hex.value = hsvaToHex(hsva); });

    for (const [el, kind] of [[sv, 'sv'], [hue, 'hue']]) {
        const fromPointer = event => {
            const rect = el.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            if (kind === 'hue') hsva.h = Math.round(x * 360);
            else {
                hsva.s = Math.round(x * 100);
                hsva.v = Math.round((1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))) * 100);
            }
            update(true);
        };
        listen(el, 'pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); el.setPointerCapture(event.pointerId); fromPointer(event);
        });
        listen(el, 'pointermove', event => { if (el.hasPointerCapture(event.pointerId)) fromPointer(event); });
        listen(el, 'pointerup', event => { if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId); });
        listen(el, 'keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
            if (kind === 'hue') hsva.h = (hsva.h + delta + 360) % 360;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') hsva.s = Math.max(0, Math.min(100, hsva.s + delta));
            else hsva.v = Math.max(0, Math.min(100, hsva.v + delta));
            update(true);
        });
    }
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'keydown', 'keyup', 'wheel']) {
        listen(popup, name, event => event.stopPropagation());
    }
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        signal.abort(); popup.remove();
        trigger.setAttribute('aria-expanded', 'false');
    };
    listen(popup, 'toggle', event => { if (event.newState === 'closed') close(); });
    listen(document, 'keydown', event => { if (event.key === 'Escape') close(); });
    listen(window, 'resize', close);
    document.body.append(popup);
    update(false);
    const rect = trigger.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - 219, rect.left))}px`;
    popup.style.top = `${Math.max(8, rect.bottom + 7 + 255 > window.innerHeight ? rect.top - 262 : rect.bottom + 7)}px`;
    popup.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    return close;
}
