/**
 * 경량 스타일 프리셋 v1 — 배경/패딩·커서 스타일 번들만 다루는 순수 함수(#77, #58 결정 4).
 *
 * 프리셋은 렌더 레시피의 부분집합이다: `background` 전체 + `cursor`의 `size`·`smoothingMs`만.
 * 줌 구간·클립 시퀀스·배지·키 오버레이, 커서의 키프레임/클릭(녹화별 이벤트 데이터)은 프리셋에
 * 담기지 않는다 — 경량 편집 헌장 그대로, 녹화별 편집과 스타일 프리셋은 별개다.
 *
 * extractStylePreset은 현재 레시피에서 스타일만 골라내고, applyStylePreset은 그 스타일을
 * 대상 레시피에 되돌려 덮어쓴다. 둘 다 순수 함수 — 입력을 변형하지 않고 새 값을 반환한다.
 */

import type { BackgroundStyle, RenderRecipe } from './recipe'

/** 프리셋이 담는 커서 스타일 — 크기·스무딩만(키프레임·클릭은 녹화별 데이터라 제외). */
export interface PresetCursorStyle {
  size: number
  smoothingMs: number
}

/** 저장된 스타일 프리셋 — 이름 붙은 배경/커서 스타일 번들. 앱 전역 저장소에 영속된다. */
export interface StylePreset {
  id: string
  name: string
  background: BackgroundStyle
  cursor: PresetCursorStyle
}

/**
 * 현재 레시피에서 스타일(배경/커서 크기·스무딩)만 골라 이름 붙은 프리셋을 만든다.
 * id는 저장 시점에 호출부(main)가 부여한다 — 순수 함수라 여기서 생성하지 않는다.
 */
export function extractStylePreset(recipe: RenderRecipe, name: string, id: string): StylePreset {
  return {
    id,
    name,
    background: recipe.background,
    cursor: { size: recipe.cursor.size, smoothingMs: recipe.cursor.smoothingMs }
  }
}

/**
 * 프리셋의 스타일을 레시피에 적용한다 — `background` 전체와 `cursor.size`/`smoothingMs`만
 * 덮어쓰고, 나머지(줌 구간·클립 시퀀스·배지·키 오버레이·커서 키프레임/클릭 등 녹화별 편집)는
 * 그대로 둔다.
 */
export function applyStylePreset(recipe: RenderRecipe, preset: StylePreset): RenderRecipe {
  return {
    ...recipe,
    background: preset.background,
    cursor: { ...recipe.cursor, size: preset.cursor.size, smoothingMs: preset.cursor.smoothingMs }
  }
}
