import { useEffect, useRef, useState } from 'react'
import {
  ONBOARDING_STEPS,
  advance,
  goBack,
  canGoBack,
  canAdvance,
  isLastStep,
  type PermissionKind,
  type PermissionStatus
} from '../../../shared/onboarding'
import { OnboardingStepBody } from './OnboardingStepBody'

/**
 * 최초 실행 온보딩 — 중앙 카드로 7단계를 오간다. Next/Back·단계 인디케이터·키보드
 * 좌우 이동을 제공하고, 마지막 단계 완료 시 플래그를 저장한 뒤 onComplete로 기존
 * 화면에 자리를 넘긴다. 단계 전이 판정은 shared/onboarding 순수 모듈이 맡는다.
 *
 * 권한 단계(#47)에서는 화면 녹화·손쉬운 사용 두 권한을 행으로 보여주고, 단계가 활성인
 * 동안에만 250ms 폴링으로 상태를 갱신한다. 두 권한이 모두 granted가 되기 전에는 Next가
 * 비활성이며, 권한이 granted로 바뀌는 것을 감지하면 재시작 확인 다이얼로그를 띄운다.
 * 그 외 단계의 본문은 렌더러에 하드코딩한다(OnboardingStepBody, #48).
 */
export function OnboardingView({ onComplete }: { onComplete: () => void }): JSX.Element {
  const [index, setIndex] = useState(0)
  // 권한 granted 여부. 폴링이 갱신하고, 권한 단계의 Next 활성과 재시작 안내에 쓴다.
  const [permissions, setPermissions] = useState<PermissionStatus>({
    screen: false,
    accessibility: false
  })

  const step = ONBOARDING_STEPS[index]
  const isPermissionStep = step.id === 'permissions'

  const goNext = (): void => {
    if (!canAdvance(index, permissions)) return
    const result = advance(index)
    if (result.kind === 'complete') {
      void window.recap.completeOnboarding().then(onComplete)
    } else {
      setIndex(result.index)
    }
  }

  const goPrev = (): void => setIndex((i) => goBack(i))

  // 키보드 좌우로 단계 이동. index·permissions가 바뀔 때마다 최신 판정으로 다시 바인딩한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, permissions])

  // 권한 단계가 활성인 동안에만 250ms 폴링. 단계를 벗어나거나 언마운트하면 멈춘다.
  // 미충족→granted 전이를 감지하면 재시작 확인 다이얼로그를 띄운다(두 권한 동일 정책).
  useEffect(() => {
    if (!isPermissionStep) return
    let cancelled = false
    let prev: PermissionStatus | null = null
    const poll = async (): Promise<void> => {
      const next = await window.recap.getPermissionStatus()
      if (cancelled) return
      setPermissions(next)
      if (
        prev &&
        ((!prev.screen && next.screen) || (!prev.accessibility && next.accessibility))
      ) {
        void window.recap.confirmRestart()
      }
      prev = next
    }
    void poll()
    const timer = setInterval(() => void poll(), 250)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isPermissionStep])

  const last = isLastStep(index)

  return (
    <section className="panel onboarding">
      <div className="onboarding-card">
        <p className="onboarding-progress">
          {index + 1} / {ONBOARDING_STEPS.length}
        </p>
        <h2 className="onboarding-step-title">{step.title}</h2>

        {isPermissionStep ? (
          <PermissionStep permissions={permissions} />
        ) : (
          <OnboardingStepBody id={step.id} />
        )}

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
          <button
            className="btn"
            onClick={goNext}
            disabled={!canAdvance(index, permissions)}
          >
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** 권한 단계 본문 — 화면 녹화·손쉬운 사용 두 행과 개발 중 안내. */
function PermissionStep({ permissions }: { permissions: PermissionStatus }): JSX.Element {
  return (
    <div className="onboarding-permissions">
      <PermissionRow
        kind="screen"
        name="화면 녹화"
        why="화면을 캡처해 녹화하려면 필요해요."
        granted={permissions.screen}
      />
      <PermissionRow
        kind="accessibility"
        name="손쉬운 사용"
        why="전역 단축키와 키 입력 표시(예정)에 필요해요."
        granted={permissions.accessibility}
      />
      <p className="onboarding-permissions-hint">
        허용을 누르면 해당 시스템 설정 패널이 열려요. 개발 중에는 목록에 “Electron”으로
        표시됩니다.
      </p>
    </div>
  )
}

/** 권한 한 행 — 이름·한 줄 설명·상태·허용 버튼. */
function PermissionRow({
  kind,
  name,
  why,
  granted
}: {
  kind: PermissionKind
  name: string
  why: string
  granted: boolean
}): JSX.Element {
  // 허용 클릭이 여러 번 겹치지 않도록 진행 중 잠근다(설정 패널 여는 동안).
  const opening = useRef(false)
  const openSettings = (): void => {
    if (opening.current) return
    opening.current = true
    void window.recap.openPermissionSettings(kind).finally(() => {
      opening.current = false
    })
  }

  return (
    <div className="permission-row">
      <div className="permission-info">
        <p className="permission-name">{name}</p>
        <p className="permission-why">{why}</p>
      </div>
      <span
        className={`permission-status${granted ? ' is-granted' : ''}`}
        role="status"
      >
        {granted ? '허용됨' : '허용 필요'}
      </span>
      <button className="btn btn-ghost permission-allow" onClick={openSettings} disabled={granted}>
        허용
      </button>
    </div>
  )
}
