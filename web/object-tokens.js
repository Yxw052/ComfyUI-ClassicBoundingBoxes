// SPDX-License-Identifier: GPL-3.0-or-later
// FLUX.3 Layout Prompt numbers every element in array order, including text.
export function objectTokenOptions(regions) {
    return (Array.isArray(regions) ? regions : []).map((region, index) => ({
        token: `<obj_${index + 1}>`,
        label: String(region?.metadata?.desc || region?.desc || region?.metadata?.text || region?.text || ""),
        color: (region?.metadata?.palette || region?.palette || [])[0] || "#99999f",
    }));
}

export function objectTokenQuery(value, start, end = start) {
    if (start !== end || start < 0 || start > value.length) return null;
    const match = /[<>obj_\d]+$/i.exec(value.slice(0, start));
    if (!match) return null;
    const lastOpen = match[0].lastIndexOf("<");
    const fragment = lastOpen < 0 ? match[0] : match[0].slice(lastOpen);
    const replaceStart = match.index + Math.max(0, lastOpen);
    if (!fragment.startsWith("<") && /[a-z\d_]/i.test(value[replaceStart - 1] || "")) return null;
    if (/^<obj_\d+>$/i.test(fragment)) return null;
    let replaceEnd = end;
    // Editing the middle of an existing reference replaces its remainder too.
    if (fragment.startsWith("<")) {
        const remainder = /^[obj_\d]*>/i.exec(value.slice(end));
        if (remainder) replaceEnd += remainder[0].length;
    } else if (value[end] === ">") replaceEnd++;
    return { start: replaceStart, end: replaceEnd, query: fragment.toLowerCase() };
}

export function filterObjectTokens(options, query) {
    const fragment = query.replace(/[<>]/g, "");
    if (!fragment) return options;
    return options.filter(({ token }) => {
        if (/^\d+$/.test(fragment)) return token.slice(5, -1).includes(fragment);
        let at = 0;
        for (const char of token.toLowerCase()) if (char === fragment[at]) at++;
        return at === fragment.length;
    });
}
