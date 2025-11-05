const PF2EC = {
  ID: "pf2e-customizer",
  SETTING_KEY: "skillVisibility",   // visibilidad de skills base
  SETTING_CUSTOM: "customSkills",   // definiciones de skills personalizadas (global)
  STYLE_TAG_ID: "pf2ec-style"       // hoja de estilos dinámica
};

// Habilidades PF2e base (para ocultar/mostrar)
const PF2E_SKILLS = [
  "acr", "arc", "ath", "cra", "dec", "dip", "itm", "med",
  "nat", "occ", "prf", "rel", "soc", "ste", "sur", "thi"
];

// Slugs completos (algunos templates los usan)
const FULL_SKILL = {
  acr: "acrobatics",
  arc: "arcana",
  ath: "athletics",
  cra: "crafting",
  dec: "deception",
  dip: "diplomacy",
  itm: "intimidation",
  med: "medicine",
  nat: "nature",
  occ: "occultism",
  prf: "performance",
  rel: "religion",
  soc: "society",
  ste: "stealth",
  sur: "survival",
  thi: "thievery"
};

// Estadísticas disponibles (solo atributo)
const ABILITIES = [
  { slug: "str", label: "Fuerza" },
  { slug: "dex", label: "Destreza" },
  { slug: "con", label: "Constitución" },
  { slug: "int", label: "Inteligencia" },
  { slug: "wis", label: "Sabiduría" },
  { slug: "cha", label: "Carisma" }
];

const RANK_LABELS = ["Untrained", "Trained", "Expert", "Master", "Legendary"];

/* ===================== Utilidades base ===================== */
function defaultVisibility() {
  return Object.fromEntries(PF2E_SKILLS.map((k) => [k, true]));
}
function normalizeVisibility(obj) {
  const base = defaultVisibility();
  if (typeof obj !== "object" || !obj) return base;
  for (const k of Object.keys(base)) {
    if (typeof obj[k] !== "boolean") obj[k] = true;
  }
  return obj;
}
function normalizeCustomSkills(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => ({
      name: String(e?.name ?? "").trim(),
      slug: String(e?.slug ?? "").trim().toLowerCase(),
      ability: String(e?.ability ?? "int").trim().toLowerCase(),
      visible: typeof e?.visible === "boolean" ? e.visible : true
    }))
    .filter((e) => e.name && e.slug && ABILITIES.some(a => a.slug === e.ability));
}
function slugify(str) {
  return String(str ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
function uniqueSlugs(items) {
  const seen = new Map();
  for (const it of items) {
    let s = it.slug || slugify(it.name);
    const base = s; let i = 2;
    while (seen.has(s) || !s) s = base ? `${base}-${i++}` : `skill-${i++}`;
    it.slug = s; seen.set(s, true);
  }
  return items;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

/* ===================== CSS dinámico (ocultar base) ===================== */
function composeCSS(visibility) {
  const hidden = Object.entries(visibility).filter(([, v]) => v === false).map(([k]) => k);
  if (!hidden.length) return "/* PF2e Customizer: all visible */";
  const blocks = [];
  for (const abbr of hidden) {
    const full = FULL_SKILL[abbr] ?? abbr;
    const set = new Set([
      `li.skill[data-skill="${abbr}"]`,
      `li.skill[data-slug="${abbr}"]`,
      `li[data-skill="${abbr}"]`,
      `li[data-slug="${abbr}"]`,
      `.skill[data-skill="${abbr}"]`,
      `.skill[data-slug="${abbr}"]`,
      `[data-statistic="${abbr}"]`,
      `tr.skill[data-skill="${abbr}"]`,
      `tr[data-skill="${abbr}"]`,
      `div.skill[data-skill="${abbr}"]`,
      `[data-action="edit-skill"][data-skill="${abbr}"]`,
      `li.skill[data-slug="${full}"]`,
      `li[data-slug="${full}"]`,
      `.skill[data-slug="${full}"]`,
      `[data-skill="${full}"]`,
      `[data-statistic="${full}"]`,
      `tr[data-skill="${full}"]`,
      `div.skill[data-skill="${full}"]`
    ]);
    blocks.push([...set].join(", "));
  }
  return `${blocks.join(",\n")} { display: none !important; }`;
}
function applyDynamicCSS() {
  const vis = normalizeVisibility(game.settings.get(PF2EC.ID, PF2EC.SETTING_KEY));
  const css = composeCSS(vis);
  let style = document.getElementById(PF2EC.STYLE_TAG_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = PF2EC.STYLE_TAG_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/* ===================== Cálculos por actor ===================== */
function getActorData(actor) {
  return (actor?.system ?? actor?.data?.data) || {};
}
function actorLevel(actor) {
  const a = getActorData(actor);
  return Number(a?.details?.level?.value ?? a?.level ?? 0);
}
function abilityMod(actor, abilitySlug) {
  try {
    const a = getActorData(actor);
    const mod = a?.abilities?.[abilitySlug]?.mod;
    return typeof mod === "number" ? mod : 0;
  } catch { return 0; }
}
function proficiencyVariantWithLevel() {
  // Si el mundo tiene "Proficiency Without Level", no se suma nivel
  const variant = game.settings.get("pf2e", "proficiencyVariant");
  return variant !== "ProficiencyWithoutLevel";
}
function proficiencyBonus(actor, rank) {
  // rank: 0..4 => 0 / 2 / 4 / 6 / 8 (+ nivel si aplica y rank>=1)
  const table = [0, 2, 4, 6, 8];
  const base = table[rank] ?? 0;
  if (rank >= 1 && proficiencyVariantWithLevel()) {
    return base + actorLevel(actor);
  }
  return base;
}

/* ===================== Flags por actor (rango de custom skills) ===================== */
function getActorRanks(actor) {
  return foundry.utils.duplicate(actor.getFlag(PF2EC.ID, "ranks") || {});
}
async function setActorRank(actor, slug, rank) {
  const ranks = getActorRanks(actor);
  ranks[slug] = Number(rank) || 0;
  await actor.setFlag(PF2EC.ID, "ranks", ranks);
}

/* ===================== Inserción en la lista nativa ===================== */
function findProficienciesList(root) {
  const q = [
    ".sheet-body .sheet-content .tab.proficiencies.major .proficiencies-list",
    ".sheet-body .sheet-content .tab[data-tab='proficiencies'].major .proficiencies-list",
    ".tab.proficiencies.major .proficiencies-list",
    ".tab[data-tab='proficiencies'] .proficiencies-list"
  ];
  for (const sel of q) {
    const n = root.querySelector(sel);
    if (n) return n;
  }
  return null;
}

function rankSelectHTML(current) {
  const opts = RANK_LABELS.map((lbl, i) =>
    `<option value="${i}" ${i === current ? "selected" : ""}>${lbl}</option>`
  ).join("");
  return `
    <select class="skill-proficiency pf-rank pf2ec-rank" data-dtype="Number">
      ${opts}
    </select>
  `;
}

function injectCustomSkillsIntoList(actor, htmlRoot) {
  const cfg = normalizeCustomSkills(game.settings.get(PF2EC.ID, PF2EC.SETTING_CUSTOM))
    .filter(e => e.visible);
  const root = htmlRoot?.[0] ?? htmlRoot;
  const list = root && findProficienciesList(root);
  if (!list) return;

  // Limpia entradas anteriores
  list.querySelectorAll("li[data-pf2ec='1']").forEach((li) => li.remove());
  if (!cfg.length) return;

  const ranks = getActorRanks(actor);

  for (const entry of cfg) {
    const rank = Number(ranks[entry.slug] ?? 0);
    const abilMod = abilityMod(actor, entry.ability);
    const prof = proficiencyBonus(actor, rank);
    const total = abilMod + prof;
    const abilLabel = getAbilityLabel(entry.ability);

    const li = document.createElement("li");
    li.setAttribute("data-pf2ec", "1");
    li.setAttribute("data-statistic", `pf2ec-${entry.slug}`);

    li.innerHTML = `
      <a class="d20 pf2ec-roll" title="Tirar 1d20 ${sign(total)} (${abilLabel}${rank ? `, ${RANK_LABELS[rank]}` : ""})" data-name="${escapeHtml(entry.name)}" data-mod="${total}">
        <div class="d20-svg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 0 19 19" preserveAspectRatio="xMinYMin meet">
            <path fill-rule="evenodd" fill="currentColor"
              d="M3.826,8.060 L0.124,13.540 C0.016,13.716 0.127,13.944 0.332,13.967 L7.637,14.743 L3.826,8.060 ZM0.341,11.589 L2.983,7.288 L0.294,5.672 C0.200,5.615 0.081,5.683 0.081,5.792 L0.081,11.515 C0.081,11.657 0.267,11.710 0.341,11.589 ZM0.722,15.391 L7.541,18.472 C7.727,18.559 7.939,18.422 7.939,18.217 L7.939,15.909 L0.799,15.125 C0.643,15.107 0.580,15.321 0.722,15.391 ZM3.571,6.330 L6.375,1.305 C6.527,1.057 6.249,0.769 5.996,0.913 L0.706,4.380 C0.620,4.437 0.622,4.565 0.711,4.618 L3.571,6.330 ZM8.500,6.687 L12.331,6.687 L8.978,0.769 C8.869,0.590 8.684,0.501 8.500,0.501 C8.316,0.501 8.132,0.590 8.022,0.769 L4.669,6.687 L8.500,6.687 ZM16.707,5.672 L14.018,7.288 L16.659,11.589 C16.733,11.710 16.919,11.657 16.919,11.515 L16.919,5.792 C16.919,5.683 16.800,5.615 16.707,5.672 ZM13.430,6.330 L16.290,4.618 C16.379,4.564 16.381,4.436 16.294,4.379 L11.004,0.913 C10.752,0.769 10.474,1.057 10.626,1.305 L13.430,6.330 ZM16.202,15.125 L9.062,15.908 L9.062,18.217 C9.062,18.422 9.274,18.558 9.460,18.472 L16.279,15.391 C16.420,15.321 16.358,15.107 16.202,15.125 ZM13.175,8.060 L9.364,14.743 L16.669,13.967 C16.874,13.944 16.986,13.716 16.877,13.540 L13.175,8.060 ZM8.500,7.812 L4.977,7.812 L8.500,13.990 L12.023,7.812 L8.500,7.812 Z">
            </path>
          </svg>
        </div>
      </a>
      <a class="modifier" title="${abilLabel} ${sign(abilMod)}${rank ? `, ${RANK_LABELS[rank]} ${sign(prof - abilMod)}` : ""}">
        ${sign(total)}
      </a>
      <div class="name">${escapeHtml(entry.name)}</div>
      ${rankSelectHTML(rank)}
    `;

    // Tirada 1d20
    li.querySelector(".pf2ec-roll")?.addEventListener("click", async (ev) => {
      ev.preventDefault();

      // Relee por si el usuario cambió el rango justo antes del click
      const currentRank  = Number(li.querySelector(".pf2ec-rank")?.value ?? rank);
      const currentAbil  = abilityMod(actor, entry.ability);
      const currentProf  = proficiencyBonus(actor, currentRank);
      const currentTotal = currentAbil + currentProf;
      const currentAbilLabel = getAbilityLabel(entry.ability);
      const rankLabel = RANK_LABELS[currentRank] ?? "Untrained";

      const flavor = `
        <h4 class="action"><strong>${escapeHtml(entry.name)} Check</strong></h4>
        <hr>
        <div class="tags modifiers">
          <span class="tag tag_transparent" data-slug="${entry.ability}">${escapeHtml(currentAbilLabel)} ${sign(currentAbil)}</span>
          <span class="tag tag_transparent" data-slug="proficiency">${rankLabel} ${sign(currentProf)}</span>
        </div>`.trim();

      const roll = await (new Roll("1d20 + @m", { m: Number(currentTotal || 0) })).roll({ async: true });

      const flags = {
        pf2e: {
          context: {
            type: "check",
            statistic: `pf2ec-${entry.slug}`,
            dc: null,
            traits: []
          }
        }
      };

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor,
        flags
      });
    });

    // Cambio de rango => guarda flag y refresca números
    li.querySelector(".pf2ec-rank")?.addEventListener("change", async (ev) => {
      const newRank = Number(ev.currentTarget.value || 0);
      await setActorRank(actor, entry.slug, newRank);

      // Recalcula totales en este LI (sin re-render completo)
      const abil = abilityMod(actor, entry.ability);
      const p = proficiencyBonus(actor, newRank);
      const tot = abil + p;
      const lbl = getAbilityLabel(entry.ability);

      li.querySelector(".modifier").textContent = sign(tot);
      const rollA = li.querySelector(".pf2ec-roll");
      rollA.dataset.mod = String(tot);
      rollA.title = `Tirar 1d20 ${sign(tot)} (${lbl}${newRank ? `, ${RANK_LABELS[newRank]}` : ""})`;
    });

    list.appendChild(li);
  }
}


/* ===================== Form de visibilidad base ===================== */
class PF2EC_SettingsForm extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "pf2ec-settings",
      title: game.i18n.localize("PF2EC.label.skillsMenu"),
      template: `modules/${PF2EC.ID}/templates/settings.hbs`,
      width: 460,
      height: "auto",
      closeOnSubmit: true
    });
  }
  getData() {
    const visibility = normalizeVisibility(game.settings.get(PF2EC.ID, PF2EC.SETTING_KEY));
    const rows = PF2E_SKILLS.map((slug) => ({
      slug,
      label: game.i18n.localize(`PF2EC.skill.${slug}`) || slug,
      visible: !!visibility[slug]
    }));
    return { rows, hint: game.i18n.localize("PF2EC.label.skillsMenuHint") };
  }
  activateListeners(html) {
    super.activateListeners(html);

    // Reset visibilidad base
    html[0].querySelector("#pf2ec-reset")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      const vis = defaultVisibility();
      game.settings.set(PF2EC.ID, PF2EC.SETTING_KEY, vis).then(() => {
        applyDynamicCSS();
        ui.notifications.info(game.i18n.localize("PF2EC.button.reset"));
        this.render(true);
      });
    });

    // Botón gestor de personalizadas
    const footer = html[0].querySelector(".form-group:last-of-type");
    if (footer && !footer.querySelector("#pf2ec-open-custom")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "pf2ec-open-custom";
      btn.innerHTML = `<i class="fas fa-plus-circle"></i> Gestionar habilidades personalizadas`;
      btn.style.marginLeft = "auto";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        PF2EC_openCustomSkillsDialog();
      });
      footer.prepend(btn);
    }
  }
  async _updateObject(event, formData) {
    const vis = {};
    for (const slug of PF2E_SKILLS) {
      const key = `vis.${slug}`;
      vis[slug] = Boolean(formData[key]);
    }
    await game.settings.set(PF2EC.ID, PF2EC.SETTING_KEY, vis);
    applyDynamicCSS();
  }
}

/* ===================== Diálogo gestor de personalizadas ===================== */
function PF2EC_openCustomSkillsDialog() {
  const stored = normalizeCustomSkills(game.settings.get(PF2EC.ID, PF2EC.SETTING_CUSTOM));
  const items = uniqueSlugs(stored.map(x => ({ ...x })));
  const abilityOptions = ABILITIES.map(a => `<option value="${a.slug}">${a.label}</option>`).join("");

  const makeRow = (it, idx) => `
    <tr data-idx="${idx}">
      <td><input type="text" class="pf2ec-c-name" value="${escapeHtml(it.name)}" placeholder="Nombre (p. ej. Montar)"></td>
      <td><input type="text" class="pf2ec-c-slug" value="${escapeHtml(it.slug)}" placeholder="slug-unico"></td>
      <td>
        <select class="pf2ec-c-ability">
          ${ABILITY_OPTIONS_FOR(it.ability, abilityOptions)}
        </select>
      </td>
      <td style="text-align:center;"><input type="checkbox" class="pf2ec-c-visible" ${it.visible ? "checked" : ""}></td>
      <td style="text-align:center;"><button type="button" class="pf2ec-c-del" title="Eliminar"><i class="fas fa-trash"></i></button></td>
    </tr>
  `;

  function ABILITY_OPTIONS_FOR(current, all) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<select>${all}</select>`;
    const sel = wrap.firstElementChild;
    Array.from(sel.options).forEach(o => { if (o.value === current) o.selected = true; });
    return sel.innerHTML;
  }

  const content = `
    <form id="pf2ec-custom-form">
      <p class="notes">Define tus habilidades personalizadas. El rango se elige en la propia hoja del actor.</p>
      <table class="pf2ec-table" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;">Nombre</th>
            <th style="text-align:left;">Slug</th>
            <th style="text-align:left;">Estadística</th>
            <th style="text-align:center;">Visible</th>
            <th style="text-align:center;">Acciones</th>
          </tr>
        </thead>
        <tbody>${items.map(makeRow).join("")}</tbody>
      </table>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="pf2ec-add-row"><i class="fas fa-plus"></i> Añadir</button>
      </div>
    </form>
  `;

  const dlg = new Dialog({
    title: "PF2e Customizer — Habilidades personalizadas",
    content,
    buttons: {
      cancel: { label: "Cancelar" },
      save: {
        label: "Guardar",
        callback: (html) => {
          const data = collectCustomForm(html[0]);
          game.settings.set(PF2EC.ID, PF2EC.SETTING_CUSTOM, data).then(() => {
            ui.notifications.info("Habilidades personalizadas guardadas.");
            // Reinyecta en hojas abiertas
            for (const app of Object.values(ui.windows)) {
              const actor = app?.actor;
              const root = app?.element?.[0];
              if (actor && root) injectCustomSkillsIntoList(actor, root);
            }
          });
        }
      }
    },
    default: "save",
    render: (html) => {
      const root = html[0];
      const tbody = root.querySelector("tbody");

      root.querySelector("#pf2ec-add-row").addEventListener("click", () => {
        const idx = tbody.querySelectorAll("tr").length;
        const blank = { name: "", slug: "", ability: "int", visible: true };
        const row = document.createElement("tr");
        row.setAttribute("data-idx", String(idx));
        row.innerHTML = makeRow(blank, idx);
        tbody.appendChild(row);
        attachRowHandlers(row);
      });

      tbody.querySelectorAll("tr").forEach(attachRowHandlers);

      function attachRowHandlers(tr) {
        const name = tr.querySelector(".pf2ec-c-name");
        const slug = tr.querySelector(".pf2ec-c-slug");
        const del  = tr.querySelector(".pf2ec-c-del");
        name?.addEventListener("change", () => {
          const s = slug.value.trim();
          if (!s || s === slugify(s)) slug.value = slugify(name.value);
        });
        del?.addEventListener("click", () => tr.remove());
      }
    }
  });
  dlg.render(true);
}

function collectCustomForm(root) {
  const rows = Array.from(root.querySelectorAll("tbody tr"));
  const data = rows.map((tr) => ({
    name: tr.querySelector(".pf2ec-c-name")?.value?.trim() ?? "",
    slug: (tr.querySelector(".pf2ec-c-slug")?.value?.trim() ?? "").toLowerCase(),
    ability: tr.querySelector(".pf2ec-c-ability")?.value ?? "int",
    visible: !!tr.querySelector(".pf2ec-c-visible")?.checked
  })).filter(e => e.name);
  uniqueSlugs(data);
  return normalizeCustomSkills(data);
}

function refreshAllSheets() {
  for (const app of Object.values(ui.windows)) {
    const actor = app?.actor;
    const root  = app?.element?.[0];
    if (actor && root) {
      try { injectCustomSkillsIntoList(actor, root); } catch (e) {}
      try { applyCustomAttributes(root); } catch (e) {}
    }
  }
}

function buildPf2eCheckFlavor({ name, abilSlug, abilLabel, abilMod, rank, prof }) {
  const rankLabel = RANK_LABELS[rank] ?? "Untrained";
  const abilTag = `<span class="tag tag_transparent" data-slug="${abilSlug}">${escapeHtml(abilLabel)} ${sign(abilMod)}</span>`;
  const profTag = `<span class="tag tag_transparent" data-slug="proficiency">${rankLabel} ${sign(prof)}</span>`;
  return `<h4 class="action"><strong>${escapeHtml(name)} Check</strong></h4><hr><div class="tags modifiers">${abilTag}${profTag}</div>`;
}

async function sendPf2eStyledRoll({ actor, name, abilSlug, abilLabel, abilMod, rank, prof, total }) {
  const roll = await (new Roll("1d20 + @m", { m: Number(total || 0) })).roll({ async: true });
  const flavor = buildPf2eCheckFlavor({ name, abilSlug, abilLabel, abilMod, rank, prof });

  // Flags mínimos compatibles con PF2e para marcarlo como "check"
  const flags = {
    pf2e: {
      context: {
        type: "check",
        statistic: name,
        dc: null,
        traits: []
      }
    }
  };

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags
  });
}


/* ===================== Hooks ===================== */
Hooks.once("init", () => {

  /* === Personalización de Atributos === */
PF2EC.SETTING_ATTRS = "customAttributes";

const DEFAULT_ATTRS = {
  str: { short: "Str", full: "Strength", visible: true },
  dex: { short: "Dex", full: "Dexterity", visible: true },
  con: { short: "Con", full: "Constitution", visible: true },
  int: { short: "Int", full: "Intelligence", visible: true },
  wis: { short: "Wis", full: "Wisdom", visible: true },
  cha: { short: "Cha", full: "Charisma", visible: true }
};

// === registro ===
game.settings.register(PF2EC.ID, PF2EC.SETTING_ATTRS, {
  scope: "world",
  config: false,
  type: Object,
  default: DEFAULT_ATTRS,
  onChange: () => refreshAllSheets()
});


 // menú de edición
game.settings.registerMenu(PF2EC.ID, "attrsMenu", {
  name: "Editar atributos",
  label: "Configurar nombres/visibilidad de atributos",
  icon: "fas fa-user-cog",
  type: class AttrsForm extends FormApplication {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "pf2ec-attrs",
        title: "PF2e Customizer — Atributos",
        template: false,
        width: 420,
        height: "auto",
        closeOnSubmit: true
      });
    }

    render(force, opts) {
      const attrs = game.settings.get(PF2EC.ID, PF2EC.SETTING_ATTRS) ?? DEFAULT_ATTRS;

      let html = `<form id="pf2ec-attrs-form" class="pf2ec-attrs">
        <p class="notes">Renombra o esconde atributos. Los cambios se aplican también a habilidades.</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr><th>Abrev.</th><th>Nombre completo</th><th style="text-align:center;">Visible</th></tr>
          </thead>
          <tbody>`;
      for (const [slug, obj] of Object.entries(attrs)) {
        html += `<tr>
          <td><input name="${slug}.short" value="${escapeHtml(obj.short)}" style="width:60px;"></td>
          <td><input name="${slug}.full" value="${escapeHtml(obj.full)}" style="width:100%;"></td>
          <td style="text-align:center;"><input type="checkbox" name="${slug}.visible" ${obj.visible ? "checked" : ""}></td>
        </tr>`;
      }
      html += `</tbody></table></form>`;

      new Dialog({
        title: this.options.title,
        content: html,
        buttons: {
          cancel: { label: "Cancelar" },
          save: {
            label: "Guardar",
            callback: (dlgHtml) => {
              // Serializa el formulario y guarda
              const form = dlgHtml[0].querySelector("#pf2ec-attrs-form");
              const fd = new FormData(form);
              // Expande a objeto
              const data = foundry.utils.expandObject(
                Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))
              );
              // Los checkbox no marcados no llegan: poner false cuando falten
              for (const slug of Object.keys(DEFAULT_ATTRS)) {
                if (!data[slug]) data[slug] = {};
                data[slug].visible = form.querySelector(`input[name="${slug}.visible"]`)?.checked ?? false;
                data[slug].short ??= DEFAULT_ATTRS[slug].short;
                data[slug].full  ??= DEFAULT_ATTRS[slug].full;
              }

              return game.settings.set(PF2EC.ID, PF2EC.SETTING_ATTRS, data).then(() => {
                ui.notifications.info("Atributos personalizados guardados.");
                // Refresca atributos en todas las hojas abiertas y relabel en habilidades
                Hooks.callAll("pf2ecUpdateAttributes");
                for (const app of Object.values(ui.windows)) {
                  const actor = app?.actor;
                  const root  = app?.element?.[0];
                  if (actor && root) {
                    try { injectCustomSkillsIntoList(actor, root); } catch (e) {}
                    try { applyCustomAttributes(root); } catch (e) {}
                  }
                }
              });
            }
          }
        },
        default: "save"
      }).render(true);
    }
  },
  restricted: true
});

  game.settings.register(PF2EC.ID, PF2EC.SETTING_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultVisibility()
  });

  game.settings.register(PF2EC.ID, PF2EC.SETTING_CUSTOM, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => refreshAllSheets()
  });

  game.settings.registerMenu(PF2EC.ID, "skillsMenu", {
    name: game.i18n.localize("PF2EC.label.skillsMenu"),
    label: game.i18n.localize("PF2EC.menu.open"),
    icon: "fas fa-eye-slash",
    type: PF2EC_SettingsForm,
    restricted: true
  });

  
});


Hooks.once("ready", () => {
  applyDynamicCSS();
  refreshAllSheets();
});


function getAttrLabels() {
  return foundry.utils.duplicate(game.settings.get(PF2EC.ID, PF2EC.SETTING_ATTRS) ?? DEFAULT_ATTRS);
}

function getAbilityLabel(abilitySlug) {
  const attrs = getAttrLabels();
  const m = attrs[abilitySlug];
  return m?.full ?? (ABILITIES.find(a => a.slug === abilitySlug)?.label ?? abilitySlug.toUpperCase());
}


function applyCustomAttributes(htmlRoot) {
  const root = htmlRoot?.[0] ?? htmlRoot;
  const section = root.querySelector(".subsection.attributes");
  if (!section) return;

  const attrs = getAttrLabels();
  section.querySelectorAll("li.attribute").forEach((li) => {
    const slug = li.dataset.attribute;
    const conf = attrs[slug];
    if (!conf) return;
    li.style.display = conf.visible ? "" : "none";
    li.querySelector(".abbreviation span")?.replaceChildren(document.createTextNode(conf.short));
    li.querySelector(".label.details-label")?.replaceChildren(document.createTextNode(conf.full));
  });
}

// hook para aplicarlo en cada render
for (const h of [
  "renderActorSheetPF2e",
  "renderCharacterSheetPF2e",
  "renderNPCSheetPF2e",
  "renderFamiliarSheetPF2e"
]) {
  Hooks.on(h, (app, html) => {
    try { injectCustomSkillsIntoList(app.actor, html); } catch (e) {}
    try { applyCustomAttributes(html); } catch (e) {}
  });
}
Hooks.on("pf2ecUpdateAttributes", () => {
  for (const app of Object.values(ui.windows)) {
    const root = app?.element?.[0];
    if (root) applyCustomAttributes(root);
  }
});




// Si cambian flags de un actor (otro usuario sube rango), actualiza vista abierta
Hooks.on("updateActor", (actor, changes) => {
  if (!changes?.flags?.[PF2EC.ID]?.ranks) return;
  for (const app of Object.values(ui.windows)) {
    if (app?.actor?.id === actor.id) {
      try { injectCustomSkillsIntoList(actor, app.element?.[0]); } catch (e) { /* noop */ }
    }
  }
});
