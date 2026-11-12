# Launch the packaged Shiny example for the scenario editor.
#' Run the bundled REDD Abacus demo Shiny application
#'
#' Launches a simple Shiny app that demonstrates the \code{scenario_editor}
#' widget using the sample data bundled in \code{inst/extdata/abacus_params_sc1.zip}.
#'
#' @param display.mode Character. Shiny display mode, one of \code{"normal"},
#'   \code{"showcase"}, or \code{"auto"}. Default \code{"normal"}.
#' @param port Integer. Port to use for the local server. Default NULL (auto).
#' @param launch.browser Logical. Whether to open a browser automatically.
#'   Default TRUE.
#'
#' @return Starts a Shiny app (invisibly).
#' @export
#'
#' @examples
#' if (interactive()) {
#'   run_demo()
#' }
run_demo <- function(display.mode = "normal",
                     port = NULL,
                     launch.browser = TRUE) {
  app_dir <- system.file("shiny", "demo", package = "abacuslib")
  if (!nzchar(app_dir) || !dir.exists(app_dir)) {
    stop("Could not find the demo app. Please re-install abacuslib.", call. = FALSE)
  }
  shiny::runApp(
    app_dir,
    display.mode  = display.mode,
    port          = port,
    launch.browser = launch.browser
  )
}

