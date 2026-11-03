import type {PointGeometry} from "core/geometry"
import type {Arrayable, Rect} from "core/types"
import {Area, AreaView} from "./area"
import type {Context2d} from "core/util/canvas"
import type {SpatialIndex} from "core/util/spatial"
import * as hittest from "core/hittest"
import * as p from "core/properties"
import {StepMode} from "core/enums"
import {flip_step_mode} from "core/util/flip_step_mode"
import {Selection} from "../selections/selection"

export interface VAreaStepView extends VAreaStep.Data {}

export class VAreaStepView extends AreaView {
  declare model: VAreaStep
  declare visuals: VAreaStep.Visuals

  protected override _bounds(bounds: Rect): Rect {
    const {pad_before, pad_after} = this.model
    const first = 0
    const last = this.data_size - 1
    const pad_first = isFinite(this.x[first] + this.y1[first] + this.y2[first])
    const pad_last = isFinite(this.x[last] + this.y1[last] + this.y2[last])
    return {
      x0: bounds.x0 - (pad_first ? pad_before : 0),
      x1: bounds.x1 + (pad_last ? pad_after : 0),
      y0: bounds.y0,
      y1: bounds.y1,
    }
  }

  protected _index_data(index: SpatialIndex): void {
    const {min, max} = Math
    const {x, y1, y2} = this

    for (let i = 0; i < this.data_size; i++) {
      const x_i = x[i]
      const y1_i = y1[i]
      const y2_i = y2[i]
      index.add_rect(x_i, min(y1_i, y2_i), x_i, max(y1_i, y2_i))
    }
  }

  protected _step_path(ctx: Context2d, mode: StepMode, sx: Arrayable<number>, sy: Arrayable<number>, from_i: number, to_i: number): void {
    // Assume the path was already moved to the first point
    let prev_x = sx[from_i]
    let prev_y = sy[from_i]
    const idx_dir = from_i < to_i ? 1 : -1
    for (let i = from_i + idx_dir; i != to_i; i += idx_dir) {
      switch (mode) {
        case "before": {
          ctx.lineTo(prev_x, sy[i])
          ctx.lineTo(sx[i], sy[i])
          break
        }
        case "after": {
          ctx.lineTo(sx[i], prev_y)
          ctx.lineTo(sx[i], sy[i])
          break
        }
        case "center": {
          const mid_x = (prev_x + sx[i]) / 2
          ctx.lineTo(mid_x, prev_y)
          ctx.lineTo(mid_x, sy[i])
          ctx.lineTo(sx[i], sy[i])
          break
        }
      }
      prev_x = sx[i]
      prev_y = sy[i]
    }
  }

  protected _paint(ctx: Context2d, _indices: Int32Array, data?: Partial<VAreaStep.Data>): void {
    const {sx, sy1, sy2} = {...this, ...data}

    const forward_mode = this.model.step_mode
    const backward_mode = flip_step_mode(this.model.step_mode)
    const {pad_before, pad_after} = this.model
    const last = sx.length - 1
    const has_before = pad_before != 0 && isFinite(this.x[0] + this.y1[0] + this.y2[0])
    const has_after = pad_after != 0 && isFinite(this.x[last] + this.y1[last] + this.y2[last])

    ctx.beginPath()
    if (has_before) {
      const pad_sx = this.renderer.xscale.s_compute(this.x[0] - pad_before)
      ctx.moveTo(pad_sx, sy1[0])
      ctx.lineTo(sx[0], sy1[0])
    } else {
      ctx.moveTo(sx[0], sy1[0])
    }

    this._step_path(ctx, forward_mode, sx, sy1, 0, sx.length)
    if (has_after) {
      const pad_sx = this.renderer.xscale.s_compute(this.x[last] + pad_after)
      ctx.lineTo(pad_sx, sy1[last])
      ctx.lineTo(pad_sx, sy2[last])
    }
    ctx.lineTo(sx[last], sy2[last])
    this._step_path(ctx, backward_mode, sx, sy2, sx.length, -1)
    if (has_before) {
      const pad_sx = this.renderer.xscale.s_compute(this.x[0] - pad_before)
      ctx.lineTo(pad_sx, sy2[0])
    }

    ctx.closePath()

    this.visuals.fill.apply(ctx)
    this.visuals.hatch.apply(ctx)
  }

  scenterxy(i: number): [number, number] {
    const scx = this.sx[i]
    const scy = (this.sy1[i] + this.sy2[i])/2
    return [scx, scy]
  }

  protected _line_selection_for(i: number): Selection {
    return Selection.create({line_indices: [i], selected_glyphs: [this.model], view: this})
  }

  protected _hit_point_before(geometry: PointGeometry): Selection {
    const {sx, sy1, sy2} = this
    for (let i = 1; i < this.data_size; i++) {
      const px = [sx[i-1], sx[i], sx[i], sx[i-1]]
      const py = [sy1[i], sy1[i], sy2[i], sy2[i]]
      if (hittest.point_in_poly(geometry.sx, geometry.sy, px, py)) {
        return this._line_selection_for(i)
      }
    }
    return Selection.create()
  }

  protected _hit_point_after(geometry: PointGeometry): Selection {
    const {sx, sy1, sy2} = this
    for (let i = 0; i < this.data_size - 1; i++) {
      const px = [sx[i], sx[i+1], sx[i+1], sx[i]]
      const py = [sy1[i], sy1[i], sy2[i], sy2[i]]
      if (hittest.point_in_poly(geometry.sx, geometry.sy, px, py)) {
        return this._line_selection_for(i)
      }
    }
    return Selection.create()
  }

  protected _hit_point_center(geometry: PointGeometry): Selection {
    const {sx, sy1, sy2} = this

    for (let i = 0; i < this.data_size; i++) {
      const mid_prev_x = (sx[i - 1] + sx[i])/2 /* undefined for first */
      const mid_next_x = (sx[i] + sx[i + 1])/2 /* undefined for last  */

      const px = (() => {
        if (i == 0) {
          return [sx[i], mid_next_x, mid_next_x, sx[i]]
        } else if (i == this.data_size - 1) {
          return [mid_prev_x, sx[i], sx[i], mid_prev_x]
        } else {
          return [mid_prev_x, mid_next_x, mid_next_x, mid_prev_x]
        }
      })()
      const py = [sy1[i], sy1[i], sy2[i], sy2[i]]

      if (hittest.point_in_poly(geometry.sx, geometry.sy, px, py)) {
        return this._line_selection_for(i)
      }
    }
    return Selection.create()
  }

  protected override _hit_point(geometry: PointGeometry): Selection {
    switch (this.model.step_mode) {
      case "before": return this._hit_point_before(geometry)
      case "after":  return this._hit_point_after(geometry)
      case "center": return this._hit_point_center(geometry)
    }
  }
}

export namespace VAreaStep {
  export type Attrs = p.AttrsOf<Props>

  export type Props = Area.Props & {
    x: p.XCoordinateSpec
    y1: p.YCoordinateSpec
    y2: p.YCoordinateSpec
    step_mode: p.Property<StepMode>
    pad_before: p.Property<number>
    pad_after: p.Property<number>
  }

  export type Visuals = Area.Visuals

  export type Data = p.GlyphDataOf<Props>
}

export interface VAreaStep extends VAreaStep.Attrs {}

export class VAreaStep extends Area {
  declare properties: VAreaStep.Props
  declare __view_type__: VAreaStepView

  static {
    this.prototype.default_view = VAreaStepView

    this.define<VAreaStep.Props>(({}) => ({
      x:         [ p.XCoordinateSpec, {field: "x"} ],
      y1:        [ p.YCoordinateSpec, {field: "y1"} ],
      y2:        [ p.YCoordinateSpec, {field: "y2"} ],
      step_mode: [ StepMode, "before" ],
    }))
    this.define<VAreaStep.Props>(({Float, NonNegative}) => ({
      pad_before: [ NonNegative(Float), 0 ],
      pad_after: [ NonNegative(Float), 0 ],
    }))
  }
}
