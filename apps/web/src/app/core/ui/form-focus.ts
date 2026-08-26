export function focusFirstInvalidControl(container: HTMLElement): void {
  const control = container.querySelector<HTMLElement>(
    'input.ng-invalid, textarea.ng-invalid, select.ng-invalid, mat-select.ng-invalid',
  );
  control?.focus();
}
