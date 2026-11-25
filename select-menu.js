(() => {
  "use strict";

  if (typeof HTMLElement.prototype.showPopover !== "function") return;

  let nextId = 0;
  let openMenu = null;

  function enhance(select) {
    if (select.hidden || select.multiple || select.size > 1 || select.querySelector("optgroup")) return;
    const id = `select-menu-${++nextId}`;
    const label = select.labels[0];
    const wrapper = document.createElement("span");
    wrapper.className = "select-menu";

    const trigger = document.createElement("button");
    trigger.id = id;
    trigger.type = "button";
    trigger.className = "select-menu-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${id}-options`);
    if (select.required) trigger.setAttribute("aria-required", "true");
    const value = document.createElement("span");
    value.id = `${id}-value`;
    const caption = document.createElement("span");
    caption.id = `${id}-label`;
    caption.className = "select-menu-label";
    trigger.append(caption, value);
    trigger.setAttribute("aria-labelledby", `${caption.id} ${value.id}`);

    const list = document.createElement("span");
    list.id = `${id}-options`;
    list.className = "select-menu-options";
    list.setAttribute("role", "listbox");
    list.setAttribute("popover", "auto");
    const labelText = label && [...label.childNodes].map((node) => node === select ? "" : node.textContent).join("").trim();
    const name = select.getAttribute("aria-label") || labelText || "选择";
    caption.textContent = name;
    list.setAttribute("aria-label", name);
    if (label) label.htmlFor = trigger.id;
    const error = document.createElement("span");
    error.id = `${id}-error`;
    error.className = "select-menu-error";
    error.hidden = true;

    const options = [...select.options];
    const rows = options.map((option, index) => {
      const row = document.createElement("span");
      row.id = `${id}-option-${index}`;
      row.className = "select-menu-option";
      row.setAttribute("role", "option");
      if (option.disabled) row.setAttribute("aria-disabled", "true");
      row.textContent = option.label;
      row.addEventListener("click", () => commit(index));
      return row;
    });
    const enabled = options.flatMap((option, i) => option.disabled ? [] : [i]);
    list.append(...rows);
    list.addEventListener("mousedown", (event) => event.preventDefault());
    list.addEventListener("click", (event) => event.preventDefault());
    let active = -1;
    let typed = "";
    let lastKey = 0;

    function sync() {
      value.textContent = select.selectedOptions[0]?.label || "请选择";
      trigger.disabled = select.disabled || !enabled.length;
      rows.forEach((row, i) => row.setAttribute("aria-selected", String(i === select.selectedIndex)));
      if (select.validity.valid) clearError();
    }

    function clearError() {
      error.hidden = true;
      trigger.removeAttribute("aria-invalid");
      trigger.removeAttribute("aria-describedby");
    }

    function highlight(index) {
      if (index == null || index < 0) return;
      rows[active]?.classList.remove("is-active");
      active = index;
      const row = rows[index];
      row.classList.add("is-active");
      trigger.setAttribute("aria-activedescendant", row.id);
      const rowBounds = row.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      if (rowBounds.top < bounds.top) list.scrollTop -= bounds.top - rowBounds.top;
      else if (rowBounds.bottom > bounds.bottom) list.scrollTop += rowBounds.bottom - bounds.bottom;
    }

    function place() {
      const bounds = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const height = viewport?.height || window.innerHeight;
      const left = viewport?.offsetLeft || 0;
      const width = Math.min(viewport?.width || Infinity, document.documentElement.clientWidth);
      const below = top + height - bounds.bottom - 12;
      const above = bounds.top - top - 12;
      if ((bounds.bottom < top || bounds.top > top + height) && list.matches(":popover-open")) {
        list.hidePopover();
        return;
      }
      const menuWidth = Math.min(Math.max(bounds.width, 192), width - 16);
      const useAbove = below < Math.min(list.scrollHeight || 280, 280) && above > below;
      list.style.width = `${menuWidth}px`;
      list.style.maxHeight = `${Math.max(0, Math.min(320, useAbove ? above : below))}px`;
      list.style.left = `${Math.max(left + 8, Math.min(bounds.left, left + width - menuWidth - 8))}px`;
      list.style.top = useAbove ? "auto" : `${bounds.bottom + 6}px`;
      list.style.bottom = useAbove ? `${window.innerHeight - bounds.top + 6}px` : "auto";
    }

    function open(index = select.selectedIndex) {
      sync();
      openMenu = { trigger, place };
      trigger.setAttribute("aria-expanded", "true");
      place();
      list.showPopover();
      place();
      highlight(enabled.includes(index) ? index : enabled[0]);
    }

    function commit(index) {
      if (!enabled.includes(index)) return;
      list.hidePopover();
      if (select.selectedIndex === index) return;
      select.selectedIndex = index;
      sync();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    trigger.addEventListener("click", () => list.matches(":popover-open") ? list.hidePopover() : open());
    trigger.addEventListener("keydown", (event) => {
      const { key } = event;
      const expanded = list.matches(":popover-open");
      if (key === "Tab" && expanded) { commit(active); return; }
      if (key === "Escape" && expanded) {
        event.preventDefault();
        event.stopPropagation();
        list.hidePopover();
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
        event.preventDefault();
        const offset = enabled.indexOf(active) + (key === "ArrowUp" ? -1 : 1);
        const index = key === "Home" ? enabled[0] : key === "End" ? enabled.at(-1) : enabled[Math.max(0, Math.min(enabled.length - 1, offset))];
        if (expanded) highlight(index);
        else open(key === "Home" || key === "End" ? index : select.selectedIndex);
      } else if (expanded && (key === "Enter" || key === " ")) {
        event.preventDefault();
        commit(active);
      } else if (key.length === 1 && key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        typed = (now - lastKey < 650 ? typed : "") + key.toLowerCase();
        lastKey = now;
        const match = enabled.find((index) => options[index].label.toLowerCase().startsWith(typed));
        if (match === undefined) return;
        event.preventDefault();
        if (expanded) highlight(match);
        else open(match);
      }
    });
    list.addEventListener("toggle", () => {
      if (list.matches(":popover-open")) return;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      rows[active]?.classList.remove("is-active");
      active = -1;
      if (openMenu?.trigger === trigger) openMenu = null;
    });
    select.addEventListener("change", sync);
    select.addEventListener("input", sync);
    select.form?.addEventListener("reset", () => queueMicrotask(() => { clearError(); sync(); }));
    select.addEventListener("invalid", (event) => {
      event.preventDefault();
      error.textContent = select.validity.valueMissing ? "请选择一项。" : select.validationMessage;
      error.hidden = false;
      trigger.setAttribute("aria-invalid", "true");
      trigger.setAttribute("aria-describedby", error.id);
      if (!select.form || select.form.querySelector(":invalid:not(form):not(fieldset)") === select) trigger.focus();
    });
    select.hidden = true;
    select.before(wrapper);
    wrapper.append(select, trigger, error, list);
    sync();
  }

  const scan = (root) => {
    if (root.matches("select")) enhance(root);
    else root.querySelectorAll("select:not([hidden])").forEach(enhance);
  };
  scan(document.documentElement);
  new MutationObserver((changes) => {
    for (const { addedNodes } of changes) {
      for (const node of addedNodes) if (node.nodeType === Node.ELEMENT_NODE && node.isConnected) scan(node);
    }
    if (openMenu && !openMenu.trigger.isConnected) openMenu = null;
  }).observe(document.body, { childList: true, subtree: true });

  const reposition = () => openMenu?.place();
  window.addEventListener("scroll", reposition, { capture: true, passive: true });
  window.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("scroll", reposition);
})();
