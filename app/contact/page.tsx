export const metadata = { title: '문의', description: '혼저 탑서에 오류 제보나 의견을 보내는 방법.' };

const EMAIL = '56866697cui@gmail.com';

export default function Contact() {
  return (
    <main className="doc">
      <h1>문의</h1>
      <p>틀린 노선, 이상한 도착 시각, 바라는 기능, 무엇이든 편하게 보내주세요.</p>
      <div className="box"><b>이메일</b><div><a href={`mailto:${EMAIL}`}>{EMAIL}</a></div></div>
      <h2>오류를 알려주실 때</h2>
      <p>아래를 함께 적어주시면 빨리 고칠 수 있어요.</p>
      <ul>
        <li>출발지와 도착지</li>
        <li>검색한 날짜와 시각</li>
        <li>화면에 나온 버스 번호와 실제로 온 버스(또는 도착 시각)</li>
      </ul>
      <p className="muted">혼저 탑서는 개인이 운영하는 사이트라 답장이 늦을 수 있어요.</p>
    </main>
  );
}
