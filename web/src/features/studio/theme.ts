import { studioTheme } from 'ag-studio';

// AG Studio theme bound to the RELIEFOS design tokens in styles/app.css.
const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });
const CHART = ['#2459c4', '#1d7347', '#9a5b0c', '#6b4fa0', '#b1261b', '#3a5a8c', '#4a5d78', '#7a818c', '#5b8def', '#c48a2c'];

export const reliefStudioTheme = studioTheme.withParams({
  fontFamily: token('font'),
  fontSize: 13,
  textColor: token('text'),
  foregroundColor: token('text'),
  subtleTextColor: token('text-3'),
  backgroundColor: token('surface'),
  borderColor: token('border'),
  accentColor: token('accent'),
  rowHoverColor: token('surface-2'),
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('bg'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('bg'),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 8,
  studioWidgetPadding: 10,
  studioWidgetTitleFontSize: 13,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('text'),
  gridFontSize: 12.5,
  gridHeaderBackgroundColor: token('surface-2'),
  gridHeaderTextColor: token('text-3'),
  gridHeaderFontWeight: 600,
  gridRowHeight: 34,
  gridRowBorder: line('border'),
  gridWrapperBorder: false,
  chartTextColor: token('text'),
  chartSubtleTextColor: token('text-3'),
  chartAxisLineColor: token('border'),
  chartGridLineColor: token('border'),
  ...Object.fromEntries(CHART.flatMap((c, i) => [[`chartPaletteFills${i + 1}Color`, c], [`chartPaletteStrokes${i + 1}Color`, c]])),
});
