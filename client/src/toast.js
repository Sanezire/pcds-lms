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

// Welcome notice on the kiosk after a successful scan. Shows "Welcome to PCDS LRC"
// with the student's ID underneath, or the ID's own message in place of the
// welcome line. Both are plain text, so a message can never inject markup.
const kioskToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 5000,
  iconColor: '#17653f',
  customClass: {
    container: 'pcds-kiosk-toast-container',
    popup: 'pcds-swal-toast pcds-kiosk-toast',
    title: 'pcds-swal-toast-title',
    htmlContainer: 'pcds-swal-toast-text',
  },
});

export const WELCOME_TEXT = 'Welcome to PCDS LRC';

export function showWelcomeToast(studentId, message) {
  return kioskToast.fire({ icon: 'success', titleText: message || WELCOME_TEXT, text: studentId });
}

export function showSuccessToast(title, text) {
  return toast.fire({ icon: 'success', title, text });
}
