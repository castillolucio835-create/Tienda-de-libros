document.querySelectorAll('button[data-book]').forEach(button => {
  button.addEventListener('click', async () => {
    const bookId = button.dataset.book;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparando…';
    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');
      window.location.href = data.checkoutUrl;
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = oldText;
    }
  });
});
