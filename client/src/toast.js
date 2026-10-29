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

// Notice on the kiosk after a successful scan. Time In shows "Welcome to PCDS LRC"
// and Time Out shows a goodbye, with the student's ID underneath. An ID's own
// message replaces that line. All plain text, so a message can never inject markup.
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
export const GOODBYE_TEXT = 'Goodbye, see you again';

export function showWelcomeToast(studentId, message, action = 'in') {
  const line = message || (action === 'out' ? GOODBYE_TEXT : WELCOME_TEXT);
  return kioskToast.fire({ icon: 'success', titleText: line, text: studentId });
}

export function showSuccessToast(title, text) {
  return toast.fire({ icon: 'success', title, text });
}
