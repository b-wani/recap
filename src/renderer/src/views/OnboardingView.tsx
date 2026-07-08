import { useEffect, useState } from 'react'
import {
  ONBOARDING_STEPS,
  advance,
  goBack,
  canGoBack,
  isLastStep
} from '../../../shared/onboarding'
import { OnboardingStepBody } from './OnboardingStepBody'

/**
 * 최초 실행 온보딩 — 중앙 카드로 7단계를 오간다. Next/Back·단계 인디케이터·키보드
 * 좌우 이동을 제공하고, 마지막 단계 완료 시 플래그를 저장한 뒤 onComplete로 기존
 * 화면에 자리를 넘긴다. 단계 전이 판정은 shared/onboarding 순수 모듈이 맡는다.
 *
 * 단계 본문은 렌더러에 하드코딩한다(OnboardingStepBody). 권한 단계(permissions)는
 * 본문 없이 제목만 두어 후속 슬라이스(#47)의 실제 권한 UI에 자리를 남긴다.
 */
export function OnboardingView({ onComplete }: { onComplete: () => void }): JSX.Element {
  const [index, setIndex] = useState(0)

  const goNext = (): void => {
    const result = advance(index)
    if (result.kind === 'complete') {
      void window.recap.completeOnboarding().then(onComplete)
    } else {
      setIndex(result.index)
    }
  }

  const goPrev = (): void => setIndex((i) => goBack(i))

  // 키보드 좌우로 단계 이동. index가 바뀔 때마다 최신 핸들러로 다시 바인딩한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index])

  const step = ONBOARDING_STEPS[index]
  const last = isLastStep(index)

  return (
    <section className="panel onboarding">
      <div className="onboarding-card">
        <p className="onboarding-progress">
          {index + 1} / {ONBOARDING_STEPS.length}
        </p>
        <h2 className="onboarding-step-title">{step.title}</h2>

        <OnboardingStepBody id={step.id} />

        <div className="onboarding-dots" role="tablist" aria-label="온보딩 단계">
          {ONBOARDING_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`onboarding-dot${i === index ? ' is-active' : ''}`}
              aria-current={i === index}
            />
          ))}
        </div>

        <div className="onboarding-nav">
          <button className="btn btn-ghost" onClick={goPrev} disabled={!canGoBack(index)}>
            이전
          </button>
          <button className="btn" onClick={goNext}>
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </section>
  )
}
