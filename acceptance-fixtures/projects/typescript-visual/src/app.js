const button = document.querySelector('#increment');
const count = document.querySelector('#count');
button.addEventListener('click', () => {
  count.textContent = String(Number(count.textContent) + 2);
});
