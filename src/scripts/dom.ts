// Tiny DOM helper shared by the interactive widgets.
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
};
