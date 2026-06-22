import { App, Modal, Setting, TextComponent } from "obsidian";
import { Spell, SpellShape } from "../types";

export interface SpellEditResult {
  shape: SpellShape;
  size: number;
  width: number | undefined;
  /** Facing direction in radians. */
  angle: number;
  label: string;
  color: string;
  visible: boolean;
}

/** Common D&D 5e area spells, as presets that fill in shape and size (feet). */
interface SpellPreset {
  name: string;
  shape: SpellShape;
  size: number;
  width?: number;
}

const SPELL_PRESETS: SpellPreset[] = [
  { name: "Fireball — 20 ft sphere", shape: "circle", size: 20 },
  { name: "Shatter — 10 ft sphere", shape: "circle", size: 10 },
  { name: "Spirit Guardians — 15 ft", shape: "circle", size: 15 },
  { name: "Sleet Storm — 40 ft cylinder", shape: "circle", size: 40 },
  { name: "Burning Hands — 15 ft cone", shape: "cone", size: 15 },
  { name: "Cone of Cold — 60 ft cone", shape: "cone", size: 60 },
  { name: "Lightning Bolt — 100×5 ft line", shape: "line", size: 100, width: 5 },
  { name: "Thunderwave — 15 ft cube", shape: "cube", size: 15 },
  { name: "Web — 20 ft cube", shape: "cube", size: 20 },
];

const SIZE_LABEL: Record<SpellShape, string> = {
  circle: "Radius (ft)",
  cone: "Length (ft)",
  line: "Length (ft)",
  cube: "Side (ft)",
};

const SHAPE_OPTIONS: Record<SpellShape, string> = {
  circle: "Circle (sphere / cylinder)",
  cone: "Cone",
  line: "Line",
  cube: "Cube (square)",
};

/** Modal to create or edit a spell area-of-effect template. */
export class SpellEditModal extends Modal {
  private result: SpellEditResult;
  private dynamicEl!: HTMLElement;
  private labelInput: TextComponent | null = null;

  constructor(
    app: App,
    spell: Pick<Spell, "shape" | "size" | "width" | "angle" | "label" | "color" | "visible">,
    private onSubmit: (result: SpellEditResult | null) => void,
    private onDelete?: () => void
  ) {
    super(app);
    this.result = {
      shape: spell.shape ?? "circle",
      size: spell.size ?? 20,
      width: spell.width,
      angle: spell.angle ?? 0,
      label: spell.label ?? "",
      color: spell.color ?? "#e67e22",
      visible: spell.visible ?? false,
    };
  }

  onOpen(): void {
    try {
      const { contentEl } = this;
      contentEl.createEl("h3", { text: "Spell area" });
      contentEl.createEl("p", {
        cls: "gm-map-modal-hint",
        text: "Sizes are in feet and scale to the grid (1 cell = the configured feet per cell). Aim cone/line/cube by dragging the handle on the map.",
      });

      new Setting(contentEl)
        .setName("Preset")
        .setDesc("Quick-fill from a common 5e spell, then tweak as needed.")
        .addDropdown((d) => {
          d.addOption("", "— custom —");
          SPELL_PRESETS.forEach((p, i) => d.addOption(String(i), p.name));
          d.setValue("");
          d.onChange((v) => {
            if (v === "") return;
            const p = SPELL_PRESETS[Number(v)];
            this.result.shape = p.shape;
            this.result.size = p.size;
            this.result.width = p.shape === "line" ? p.width ?? 5 : undefined;
            if (!this.result.label) this.result.label = p.name.split(" — ")[0];
            this.renderDynamic();
            // Reset the dropdown so the same preset can be reapplied.
            d.setValue("");
            this.labelInput?.setValue(this.result.label);
          });
        });

      new Setting(contentEl).setName("Shape").addDropdown((d) => {
        (Object.keys(SHAPE_OPTIONS) as SpellShape[]).forEach((s) =>
          d.addOption(s, SHAPE_OPTIONS[s])
        );
        d.setValue(this.result.shape);
        d.onChange((v) => {
          this.result.shape = v as SpellShape;
          if (this.result.shape === "line" && !this.result.width) {
            this.result.width = 5;
          }
          this.renderDynamic();
        });
      });

      // Container for shape-dependent fields (size / width / rotation).
      this.dynamicEl = contentEl.createDiv();
      this.renderDynamic();

      new Setting(contentEl).setName("Label").addText((t) => {
        this.labelInput = t;
        t.setValue(this.result.label)
          .setPlaceholder("e.g. Fireball")
          .onChange((v) => (this.result.label = v));
      });

      new Setting(contentEl).setName("Color").addColorPicker((c) =>
        c.setValue(this.result.color).onChange((v) => (this.result.color = v))
      );

      new Setting(contentEl)
        .setName("Visible to players")
        .setDesc("When on, this template also appears on the player view.")
        .addToggle((t) =>
          t.setValue(this.result.visible).onChange((v) => (this.result.visible = v))
        );

      const buttons = new Setting(contentEl);
      if (this.onDelete) {
        buttons.addButton((b) => {
          b.setButtonText("Delete");
          if (typeof b.setDestructive === "function") b.setDestructive();
          else b.setClass("mod-warning");
          b.onClick(() => {
            try {
              this.onDelete?.();
              this.close();
            } catch (e) {
              console.error("GM Map Error on spell delete click:", e);
            }
          });
        });
      }
      buttons.addButton((b) => {
        b.setButtonText("Cancel");
        b.onClick(() => {
          try {
            this.onSubmit(null);
            this.close();
          } catch (e) {
            console.error("GM Map Error on spell cancel click:", e);
          }
        });
      });
      buttons.addButton((b) => {
        b.setButtonText("Save");
        if (typeof b.setCta === "function") b.setCta();
        else b.setClass("mod-cta");
        b.onClick(() => {
          try {
            if (this.result.shape !== "line") this.result.width = undefined;
            this.onSubmit(this.result);
            this.close();
          } catch (e) {
            console.error("GM Map Error on spell save click:", e);
          }
        });
      });
    } catch (err) {
      console.error("GM Map: Error in SpellEditModal.onOpen", err);
    }
  }

  /** (Re)draw the size / width / rotation fields for the current shape. */
  private renderDynamic(): void {
    this.dynamicEl.empty();

    new Setting(this.dynamicEl)
      .setName(SIZE_LABEL[this.result.shape])
      .setDesc(
        this.result.shape === "cone"
          ? "A cone's far end is exactly as wide as it is long."
          : "Measured in feet."
      )
      .addText((t) =>
        t.setValue(String(this.result.size)).onChange((v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) this.result.size = n;
        })
      );

    if (this.result.shape === "line") {
      new Setting(this.dynamicEl)
        .setName("Width (ft)")
        .setDesc("Thickness of the line.")
        .addText((t) =>
          t.setValue(String(this.result.width ?? 5)).onChange((v) => {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) this.result.width = n;
          })
        );
    }

    if (this.result.shape !== "circle") {
      new Setting(this.dynamicEl)
        .setName("Rotation (°)")
        .setDesc("0 = pointing right. You can also drag the handle on the map.")
        .addSlider((s) =>
          s
            .setLimits(0, 355, 5)
            .setValue(Math.round((this.result.angle * 180) / Math.PI) % 360)
            .setDynamicTooltip()
            .onChange((v) => (this.result.angle = (v * Math.PI) / 180))
        );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
