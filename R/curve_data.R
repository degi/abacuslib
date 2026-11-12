# Load the bundled sample data used by the abatement cost curve widget.
#' Example curve dataset
#'
#' Returns the example dataset bundled with the package.
#'
#' @return A data.frame with columns label, legend, x, y.
#' @export
curve_data <- function() {
  # Look in inst/extdata/ (correct location for non-rda data files)
  csv_path <- system.file("extdata", "curve_data.csv", package = "abacuslib")
  if (nzchar(csv_path) && file.exists(csv_path) && file.info(csv_path)$size > 0) {
    return(utils::read.csv(csv_path, stringsAsFactors = FALSE))
  }
  # Development fallback: source tree location
  dev_path <- file.path("inst", "extdata", "curve_data.csv")
  if (file.exists(dev_path) && file.info(dev_path)$size > 0) {
    return(utils::read.csv(dev_path, stringsAsFactors = FALSE))
  }
  stop("curve_data.csv not found in inst/extdata/")
}
