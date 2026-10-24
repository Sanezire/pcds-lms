import Swal from 'sweetalert2';

// Themed in styles.css under the pcds-swal-* classes.
const themed = Swal.mixin({
  buttonsStyling: false,
  reverseButtons: true,
  focusCancel: true,
  showCancelButton: true,
  heightAuto: false,
  customClass: {
    container: 'pcds-swal-container',
    popup: 'pcds-swal-popup',
    title: 'pcds-swal-title',
    htmlContainer: 'pcds-swal-text',
    image: 'pcds-swal-image',
    actions: 'pcds-swal-actions',
    confirmButton: 'btn btn-primary btn-lg btn-danger-solid',
    cancelButton: 'btn btn-quiet btn-lg',
  },
});

// Resolves to true when the person confirms the delete, false otherwise.
export async function confirmDelete({ title, text, confirmText = 'Delete' }) {
  const result = await themed.fire({
    title,
    text,
    imageUrl: '/images/delete_icon.png',
    imageWidth: 64,
    imageHeight: 64,
    imageAlt: '',
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
  });
  return result.isConfirmed;
}
