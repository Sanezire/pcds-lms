import Swal from 'sweetalert2';

// Small notice in the top right corner that closes itself. Themed in
// styles.css under the pcds-swal-toast classes.
const toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  iconColor: '#17653f',
  customClass: {
    popup: 'pcds-swal-toast',
    title: 'pcds-swal-toast-title',
    htmlContainer: 'pcds-swal-toast-text',
    timerProgressBar: 'pcds-swal-toast-bar',
  },
  // Keep it open while the pointer is on it.
  didOpen: (el) => {
    el.addEventListener('mouseenter', Swal.stopTimer);
    el.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export function showSuccessToast(title, text) {
  return toast.fire({ icon: 'success', title, text });
}
