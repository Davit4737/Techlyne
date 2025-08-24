function animateNumber(id, target, duration){
  const el = document.getElementById(id);
  let start = 0;
  const stepTime = Math.abs(Math.floor(duration / target));
  const timer = setInterval(() => {
    start++;
    el.innerText = start.toLocaleString();
    if(start >= target) clearInterval(timer);
  }, stepTime);
}

animateNumber("total-distributed", 742000, 4000);
animateNumber("users-received", 371, 3000);
animateNumber("tokens-left", 258000, 5000);