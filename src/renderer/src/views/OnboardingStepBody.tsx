import type { OnboardingStepId } from '../../../shared/onboarding'

/**
 * 온보딩 각 단계의 본문 콘텐츠 — 렌더러 하드코딩. 문구는 CONTEXT.md 용어(녹화,
 * 자동 효과, 경량 편집, 익스포트, 익스포트 프리셋)를 그대로 쓴다. Cap의 문구·에셋을
 * 복사하지 않는다(ADR 0002).
 *
 * 권한 단계(permissions)는 본문이 없다 — 후속 슬라이스(#47)의 실제 권한 UI가 채운다.
 */
export function OnboardingStepBody({ id }: { id: OnboardingStepId }): JSX.Element | null {
  switch (id) {
    case 'permissions':
      // 권한 단계는 다른 슬라이스(#47) 소관 — 본문을 두지 않는다.
      return null

    case 'overview':
      return (
        <div className="onboarding-body">
          <p className="onboarding-lead">
            Recap은 개발한 화면을 녹화하고 자동 효과를 입혀, Dooray 업무에 첨부할
            짧은 데모 GIF(1~2분)를 만드는 macOS 앱이에요.
          </p>
          <ul className="onboarding-list">
            <li>
              <b>녹화 + 자동 효과</b> — 화면을 담고 클릭에 맞춰 자동으로 줌·커서 효과를 입혀요.
            </li>
            <li>
              <b>경량 편집</b> — 앞뒤를 다듬고 줌 구간과 배경을 손봐요.
            </li>
            <li>
              <b>익스포트</b> — Dooray 업무에 바로 붙일 GIF로 내보내요.
            </li>
          </ul>
        </div>
      )

    case 'feature-recording':
      return (
        <div className="onboarding-body">
          <p className="onboarding-lead">
            녹화는 원본 화면 영상과 이벤트 트랙(마우스 위치·클릭 로그)을 함께 담아요. 자동 효과는
            녹화 중이 아니라 녹화가 끝난 뒤 후처리에서 입혀집니다.
          </p>
          <ul className="onboarding-list">
            <li>
              <b>클릭 기반 자동 줌</b> — 클릭한 지점으로 확대해요.
            </li>
            <li>
              <b>커서 스무딩</b> — 마우스 움직임을 부드럽게 다듬어요.
            </li>
            <li>
              <b>클릭 하이라이트</b> — 클릭 순간을 눈에 띄게 표시해요.
            </li>
          </ul>
        </div>
      )

    case 'feature-editing':
      return (
        <div className="onboarding-body">
          <p className="onboarding-lead">
            경량 편집은 필요한 만큼만 가볍게 다듬는 작업이에요.
          </p>
          <ul className="onboarding-list">
            <li>
              <b>앞뒤 트리밍</b> — 시작·끝의 군더더기를 잘라내요.
            </li>
            <li>
              <b>줌 구간 조정</b> — 자동 생성된 줌 구간을 옮기거나 길이를 바꿔요.
            </li>
            <li>
              <b>배경·패딩 스타일</b> — 영상 둘레의 배경과 여백을 꾸며요.
            </li>
          </ul>
          <p className="onboarding-note">
            컷 편집·속도 조절·자막은 없어요 — 잘못 담겼다면 다시 녹화하세요.
          </p>
        </div>
      )

    case 'feature-export':
      return (
        <div className="onboarding-body">
          <p className="onboarding-lead">
            익스포트는 렌더 레시피를 원본에 적용해 최종 파일을 만드는 단계예요. 미리보기로 확인한
            뒤 실행합니다.
          </p>
          <ul className="onboarding-list">
            <li>
              <b>Dooray GIF 프리셋</b> — Dooray 업무 첨부에 맞춘 GIF로 내보내요.
            </li>
            <li>
              <b>완료 알림</b> — 끝나면 파일을 클립보드에 복사하고 알려줘요. Dooray 업무에 ⌘V로
              바로 붙일 수 있어요.
            </li>
          </ul>
        </div>
      )

    case 'shortcuts':
      return (
        <div className="onboarding-body">
          <p className="onboarding-lead">
            전역 단축키 <kbd className="onboarding-kbd">⌥⌘R</kbd>로 캡처 툴바를 불러와요.
            녹화 중에 누르면 바로 정지합니다. 어떤 앱을 쓰고 있든 동작해요.
          </p>
          <p className="onboarding-note">
            Recap은 메뉴바에 상주해요. 창을 닫아도 종료되지 않고, 메뉴바 아이콘 →
            “Welcome 다시 보기”로 이 안내를 언제든 다시 열 수 있어요.
          </p>
        </div>
      )

    case 'faq':
      return (
        <div className="onboarding-body">
          <dl className="onboarding-faq">
            <dt>녹화가 안 돼요</dt>
            <dd>
              화면 녹화 권한이 필요해요. 시스템 설정 &gt; 개인정보 보호 및 보안 &gt; 화면 기록에서
              Recap을 켜세요. 개발 중에는 목록에 &quot;Electron&quot;으로 표시됩니다.
            </dd>
            <dt>파일은 어디에 저장되나요</dt>
            <dd>
              녹화는 <code>~/Movies/Recap/</code> 아래 녹화 시각별 폴더에 저장돼요. 익스포트한
              파일은 저장할 위치를 직접 고릅니다.
            </dd>
            <dt>GIF가 너무 커요</dt>
            <dd>
              익스포트 시 Dooray GIF 프리셋에 맞춰 화면을 축소해 담아요. 그래도 크면 트림으로
              길이를 줄이면 용량이 함께 줄어듭니다.
            </dd>
          </dl>
        </div>
      )
  }
}
