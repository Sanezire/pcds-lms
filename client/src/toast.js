import Swal from 'sweetalert2';

// Small notice in the top right corner that closes itself. Themed in
// styles.css under the pcds-swal-toast classes.
const toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  iconColor: '#17653f',
  customClass: {
    popup: 'pcds-swal-toast',
    title: 'pcds-swal-toast-title',
    htmlContainer: 'pcds-swal-toast-text',
  },
  // Keep it open while the pointer is on it.
  didOpen: (el) => {
    el.addEventListener('mouseenter', Swal.stopTimer);
    el.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

// Wording of the kiosk notice after a successful scan (the notices themselves are
// drawn by the kiosk page, which stacks them).
export const WELCOME_TEXT = 'Welcome to PCDS LRC';
export const GOODBYE_TEXT = 'Goodbye, see you again';

export function showSuccessToast(title, text) {
  return toast.fire({ icon: 'success', title, text });
}
