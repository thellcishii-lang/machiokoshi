// components/PoweredByFooter.tsx
// 来場者・参加店向け画面（/e/[eventId] 配下）の最下部に出す控えめなクレジット。
// これらの画面で Push-taro の名前が出るのはここだけにする
// （ヘッダーはプロジェクト名を出す）。色は各画面のベージュ・茶系に合わせる。
export default function PoweredByFooter() {
  return (
    <footer
      style={{
        marginTop: 40,
        paddingTop: 16,
        borderTop: '1px solid #E8DCC4',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 12, color: '#97826A', margin: 0 }}>
        powered by{' '}
        <a
          href="https://push-taro.com"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#8B5E34', fontWeight: 700, textDecoration: 'none' }}
        >
          Push-taro
        </a>
      </p>
    </footer>
  );
}
