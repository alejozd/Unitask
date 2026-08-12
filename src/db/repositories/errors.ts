export class SemesterReadOnlyError extends Error {
  constructor() {
    super("No se puede modificar una materia de un semestre cerrado.");
    this.name = "SemesterReadOnlyError";
  }
}
