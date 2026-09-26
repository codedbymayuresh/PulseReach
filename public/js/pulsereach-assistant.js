(() => {
  const style = document.createElement('style');
  style.textContent = `
  .pr-chat-launcher{position:fixed;right:24px;bottom:24px;z-index:9999;width:58px;height:58px;border:0;border-radius:50%;background:#111827;color:#fff;box-shadow:0 14px 35px rgba(15,23,42,.28);cursor:pointer;font-size:23px}.pr-chat-launcher:hover{transform:translateY(-2px)}
  .pr-chat{position:fixed;right:24px;bottom:94px;z-index:9999;width:min(380px,calc(100vw - 32px));height:540px;background:#fff;border:1px solid #e4e8ef;border-radius:22px;box-shadow:0 24px 70px rgba(15,23,42,.22);display:none;overflow:hidden;font-family:inherit}.pr-chat.open{display:flex;flex-direction:column}
  .pr-chat-head{padding:17px 18px;background:linear-gradient(135deg,#111827,#26364e);color:#fff;display:flex;align-items:center;justify-content:space-between}.pr-chat-brand{display:flex;gap:11px;align-items:center}.pr-chat-avatar{width:38px;height:38px;border-radius:13px;background:rgba(255,255,255,.12);display:grid;place-items:center;font-size:19px}.pr-chat-head b{display:block;font-size:14px}.pr-chat-head small{color:#cbd5e1;font-size:11px}.pr-chat-close{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer}
  .pr-chat-messages{flex:1;padding:16px;overflow:auto;background:#f7f9fc}.pr-msg{max-width:86%;padding:11px 13px;border-radius:15px;margin-bottom:10px;font-size:13px;line-height:1.48}.pr-msg.bot{background:#fff;border:1px solid #e6eaf0;color:#273142;border-top-left-radius:5px}.pr-msg.user{margin-left:auto;background:#172033;color:#fff;border-top-right-radius:5px}.pr-msg.typing{color:#7b8494}.pr-quick{display:flex;flex-wrap:wrap;gap:7px;padding:10px 14px;background:#fff;border-top:1px solid #edf0f4}.pr-quick button{border:1px solid #dce2e9;background:#fff;border-radius:999px;padding:7px 10px;font-size:11px;color:#374151;cursor:pointer}.pr-quick button:hover{background:#f4f6f8}.pr-chat-input{display:flex;gap:8px;padding:12px 14px;background:#fff;border-top:1px solid #edf0f4}.pr-chat-input input{min-width:0;flex:1;border:1px solid #dce2e9;border-radius:12px;padding:10px 12px;outline:none;font:inherit;font-size:13px}.pr-chat-input button{width:42px;border:0;border-radius:12px;background:#172033;color:#fff;cursor:pointer}.pr-chat-note{font-size:9px;color:#9aa3af;text-align:center;padding:0 12px 8px;background:#fff}
  @media(max-width:520px){.pr-chat-launcher{right:16px;bottom:16px}.pr-chat{right:16px;bottom:86px;height:calc(100vh - 110px);max-height:540px}}
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.innerHTML = `
    <button class="pr-chat-launcher" aria-label="Open PulseReach Assistant">✦</button>
    <section class="pr-chat" aria-label="PulseReach Assistant">
      <header class="pr-chat-head"><div class="pr-chat-brand"><div class="pr-chat-avatar">♥</div><div><b>PulseReach Assistant</b><small>Here to help with your drive</small></div></div><button class="pr-chat-close" aria-label="Close">×</button></header>
      <div class="pr-chat-messages"></div>
      <div class="pr-quick"><button data-q="How do I register for a drive?">Register for a drive</button><button data-q="Where can I see my donations?">My donations</button><button data-q="How can I get my certificate?">My certificates</button><button data-q="What is PulseReach?">What is PulseReach?</button></div>
      <div class="pr-chat-input"><input placeholder="Ask about PulseReach..." maxlength="180"><button aria-label="Send">➤</button></div>
      <div class="pr-chat-note">PulseReach Assistant · Mobilisation support</div>
    </section>`;
  document.body.appendChild(box);

  const chat = box.querySelector('.pr-chat'), launcher=box.querySelector('.pr-chat-launcher'), close=box.querySelector('.pr-chat-close'), messages=box.querySelector('.pr-chat-messages'), input=box.querySelector('input'), send=box.querySelector('.pr-chat-input button');
  const answers = [
    {keys:['register','registration','drive','join'], text:'You can register for a blood donation drive from the Upcoming Drives section. Open a drive, review its details, and choose Register for Drive.'},
    {keys:['donation history','donations','previous donation','history'], text:'Your previous donations are available in your Donor Dashboard under Donation History, along with the recorded date, location, and available e-certificate.'},
    {keys:['certificate','certificate'], text:'Completed donation e-certificates appear in your Donor Dashboard under Donation History. Select View e-certificate to open it.'},
    {keys:['pulseReach','what is pulsereach','what is pulsereach'], text:'PulseReach is a blood-donation mobilisation platform that helps organisers manage drives, registrations, consent-aware communication, reminders, turnout prediction, and attendance.'},
    {keys:['login','sign in','account'], text:'Donors can use Donor Login with their mobile number and account password. After login, your dashboard shows your registrations, donations, certificates, and upcoming drives.'},
    {keys:['reminder','notification','notifications'], text:'PulseReach uses communication preferences and donor status to support responsible reminders. Your dashboard also shows your current notification status.'},
    {keys:['eligible','eligibility','medical'], text:'PulseReach does not determine medical eligibility. Screening and final donation decisions are handled by authorised medical professionals at the drive.'},
    {keys:['help','hello','hi','hey'], text:'I can help with drive registration, donor accounts, donation history, certificates, reminders, and PulseReach.'}
  ];
  function answer(q){const s=q.toLowerCase().trim(); for(const a of answers){if(a.keys.some(k=>s.includes(k.toLowerCase()))) return a.text;} return 'I can help with drive registration, donor accounts, donation history, certificates, reminders, and PulseReach. Try one of the quick options below.';}
  function add(text,type){const m=document.createElement('div');m.className='pr-msg '+type;m.textContent=text;messages.appendChild(m);messages.scrollTop=messages.scrollHeight;}
  function sendMessage(q){q=String(q||'').trim();if(!q)return;add(q,'user');const t=document.createElement('div');t.className='pr-msg bot typing';t.textContent='Typing…';messages.appendChild(t);messages.scrollTop=messages.scrollHeight;setTimeout(()=>{t.remove();add(answer(q),'bot');},420);}
  function open(){chat.classList.add('open'); if(!messages.children.length){setTimeout(()=>add('Hi! I’m the PulseReach Assistant. I can help you navigate drives, registrations, donations and certificates. What would you like to know?','bot'),120);} input.focus();}
  launcher.onclick=open;close.onclick=()=>chat.classList.remove('open');send.onclick=()=>{sendMessage(input.value);input.value='';};input.addEventListener('keydown',e=>{if(e.key==='Enter'){send.click();}});box.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>sendMessage(b.dataset.q));
})();
