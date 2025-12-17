document.addEventListener('DOMContentLoaded', function() {
  const imageContainers = document.querySelectorAll('.zoomable-image-container');
  const fullPage = document.getElementById('fullpage');
  const fullscreenImage = document.getElementById('fullscreen-image');
  const closeBtn = document.querySelector('#fullpage .close-btn');

  imageContainers.forEach(container => {
    const img = container.querySelector('img');

    container.addEventListener('click', function() {
      fullscreenImage.src = img.src;
      fullscreenImage.alt = img.alt;
      fullPage.style.display = 'block';
    });
  });

  closeBtn.addEventListener('click', function() {
    fullPage.style.display = 'none';
  });

  fullPage.addEventListener('click', function(event) {
    if (event.target === fullPage) {
      fullPage.style.display = 'none';
    }
  });
});

