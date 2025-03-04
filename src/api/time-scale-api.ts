import { Size } from 'fancy-canvas';

import { TimeAxisWidget } from '../gui/time-axis-widget';

import { assert } from '../helpers/assertions';
import { Delegate } from '../helpers/delegate';
import { IDestroyable } from '../helpers/idestroyable';
import { clone, DeepPartial } from '../helpers/strict-type-checks';

import { ChartModel } from '../model/chart-model';
import { Coordinate } from '../model/coordinate';
import { IHorzScaleBehavior, InternalHorzScaleItem } from '../model/ihorz-scale-behavior';
import { Logical, LogicalRange, Range, TimePointIndex } from '../model/time-data';
import { HorzScaleOptions, TimeScale } from '../model/time-scale';

import {
	ITimeScaleApi,
	LogicalRangeChangeEventHandler,
	SizeChangeEventHandler,
	TimeRangeChangeEventHandler,
} from './itime-scale-api';
const enum Constants {
	AnimationDurationMs = 1000,
}

export class TimeScaleApi<HorzScaleItem> implements ITimeScaleApi<HorzScaleItem>, IDestroyable {
	private _model: ChartModel<HorzScaleItem>;
	private _timeScale: TimeScale<HorzScaleItem>;
	private readonly _timeAxisWidget: TimeAxisWidget<HorzScaleItem>;
	private readonly _timeRangeChanged: Delegate<Range<HorzScaleItem> | null> = new Delegate();
	private readonly _logicalRangeChanged: Delegate<LogicalRange | null> = new Delegate();
	private readonly _sizeChanged: Delegate<number, number> = new Delegate();

	private readonly _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	public constructor(model: ChartModel<HorzScaleItem>, timeAxisWidget: TimeAxisWidget<HorzScaleItem>, horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>) {
		this._model = model;
		this._timeScale = model.timeScale();
		this._timeAxisWidget = timeAxisWidget;
		this._timeScale.visibleBarsChanged().subscribe(this._onVisibleBarsChanged.bind(this));
		this._timeScale.logicalRangeChanged().subscribe(this._onVisibleLogicalRangeChanged.bind(this));
		this._timeAxisWidget.sizeChanged().subscribe(this._onSizeChanged.bind(this));

		this._horzScaleBehavior = horzScaleBehavior;
	}

	public destroy(): void {
		this._timeScale.visibleBarsChanged().unsubscribeAll(this);
		this._timeScale.logicalRangeChanged().unsubscribeAll(this);
		this._timeAxisWidget.sizeChanged().unsubscribeAll(this);
		this._timeRangeChanged.destroy();
		this._logicalRangeChanged.destroy();
		this._sizeChanged.destroy();
	}

	public scrollPosition(): number {
		return this._timeScale.rightOffset();
	}

	public scrollToPosition(position: number, animated: boolean): void {
		if (!animated) {
			this._model.setRightOffset(position);
			return;
		}

		this._timeScale.scrollToOffsetAnimated(position, Constants.AnimationDurationMs);
	}

	public scrollToRealTime(): void {
		this._timeScale.scrollToRealTime();
	}

	public getVisibleRange(): Range<HorzScaleItem> | null {
		const timeRange = this._timeScale.visibleTimeRange();

		if (timeRange === null) {
			return null;
		}

		return {
			from: timeRange.from.originalTime as HorzScaleItem,
			to: timeRange.to.originalTime as HorzScaleItem,
		};
	}

	public setVisibleRange(range: Range<HorzScaleItem>): void {
		const convertedRange: Range<InternalHorzScaleItem> = {
			from: this._horzScaleBehavior.convertHorzItemToInternal(range.from),
			to: this._horzScaleBehavior.convertHorzItemToInternal(range.to),
		};
		const logicalRange = this._timeScale.logicalRangeForTimeRange(convertedRange);

		this._model.setTargetLogicalRange(logicalRange);
	}

	public getVisibleLogicalRange(): LogicalRange | null {
		const logicalRange = this._timeScale.visibleLogicalRange();
		if (logicalRange === null) {
			return null;
		}

		return {
			from: logicalRange.left(),
			to: logicalRange.right(),
		};
	}

	public setVisibleLogicalRange(range: Range<number>): void {
		assert(range.from <= range.to, 'The from index cannot be after the to index.');
		this._model.setTargetLogicalRange(range as LogicalRange);
	}

	public resetTimeScale(): void {
		this._model.resetTimeScale();
	}

	public fitContent(): void {
		this._model.fitContent();
	}

	public logicalToCoordinate(logical: Logical): Coordinate | null {
		const timeScale = this._model.timeScale();

		if (timeScale.isEmpty()) {
			return null;
		} else {
			return timeScale.indexToCoordinate(logical as unknown as TimePointIndex);
		}
	}

	public coordinateToLogical(x: number): Logical | null {
		if (this._timeScale.isEmpty()) {
			return null;
		} else {
			return this._timeScale.coordinateToIndex(x as Coordinate) as unknown as Logical;
		}
	}

	public timeToCoordinate(time: HorzScaleItem): Coordinate | null {
		const timePoint = this._horzScaleBehavior.convertHorzItemToInternal(time);
		const timePointIndex = this._timeScale.timeToIndex(timePoint, false);
		if (timePointIndex === null) {
			return null;
		}

		return this._timeScale.indexToCoordinate(timePointIndex);
	}

	public timeToCoordinateRounded(time: HorzScaleItem): Coordinate {
		const timePoint = this._horzScaleBehavior.convertHorzItemToInternal(time);
		const timePointIndex = this._timeScale.timeToIndex(timePoint, true);

		if (timePointIndex === null) {
			const visibleRange = this._timeScale.visibleStrictRange();
			if (visibleRange === null) {
				return 0 as Coordinate;
			}

			const firstIndex = visibleRange.left();
			const lastIndex = visibleRange.right();

			const firstTime = this._timeScale.indexToTime(firstIndex);
			const lastTime = this._timeScale.indexToTime(lastIndex);

			if (firstTime === null || lastTime === null) {
				return this._timeScale.indexToCoordinate(firstIndex);
			}

			const firstDiff = this._horzScaleBehavior.key(time) - this._horzScaleBehavior.key(firstTime as HorzScaleItem);
			const lastDiff = this._horzScaleBehavior.key(time) - this._horzScaleBehavior.key(lastTime as HorzScaleItem);

			return Math.abs(firstDiff) <= Math.abs(lastDiff) ?
				this._timeScale.indexToCoordinate(firstIndex) :
				this._timeScale.indexToCoordinate(lastIndex);
		}

		return this._timeScale.indexToCoordinate(timePointIndex);
	}

	public coordinateToTime(x: number): HorzScaleItem | null {
		const timeScale = this._model.timeScale();
		const timePointIndex = timeScale.coordinateToIndex(x as Coordinate);
		const timePoint = timeScale.indexToTimeScalePoint(timePointIndex);
		if (timePoint === null) {
			return null;
		}

		return timePoint.originalTime as HorzScaleItem;
	}

	public width(): number {
		return this._timeAxisWidget.getSize().width;
	}

	public height(): number {
		return this._timeAxisWidget.getSize().height;
	}

	public subscribeVisibleTimeRangeChange(handler: TimeRangeChangeEventHandler<HorzScaleItem>): void {
		this._timeRangeChanged.subscribe(handler);
	}

	public unsubscribeVisibleTimeRangeChange(handler: TimeRangeChangeEventHandler<HorzScaleItem>): void {
		this._timeRangeChanged.unsubscribe(handler);
	}

	public subscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeEventHandler): void {
		this._logicalRangeChanged.subscribe(handler);
	}

	public unsubscribeVisibleLogicalRangeChange(handler: LogicalRangeChangeEventHandler): void {
		this._logicalRangeChanged.unsubscribe(handler);
	}

	public subscribeSizeChange(handler: SizeChangeEventHandler): void {
		this._sizeChanged.subscribe(handler);
	}

	public unsubscribeSizeChange(handler: SizeChangeEventHandler): void {
		this._sizeChanged.unsubscribe(handler);
	}

	public applyOptions(options: DeepPartial<HorzScaleOptions>): void {
		this._timeScale.applyOptions(options);
	}

	public options(): Readonly<HorzScaleOptions> {
		return {
			...clone(this._timeScale.options()),
			barSpacing: this._timeScale.barSpacing(),
		};
	}

	private _onVisibleBarsChanged(): void {
		if (this._timeRangeChanged.hasListeners()) {
			this._timeRangeChanged.fire(this.getVisibleRange());
		}
	}

	private _onVisibleLogicalRangeChanged(): void {
		if (this._logicalRangeChanged.hasListeners()) {
			this._logicalRangeChanged.fire(this.getVisibleLogicalRange());
		}
	}

	private _onSizeChanged(size: Size): void {
		this._sizeChanged.fire(size.width, size.height);
	}
}
