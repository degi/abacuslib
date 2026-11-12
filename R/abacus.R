


# Helpers for parsing tab-separated values and preserving non-numeric cells.
some_to_numeric <- function(x) {
  suppressWarnings(y <- as.numeric(x))
  ylist <- as.list(y)
  i <- which(is.na(y))
  ylist[i] <- x[i]
  return(ylist)
}


table_element <- function(dlist, linestr, header) {
  if (substring(linestr, 1, 2) == "//") {
    columns <- unlist(strsplit(trimws(substring(linestr, 3)), "\t"))
    df = data.frame(matrix(nrow = 0, ncol = length(columns)))
    colnames(df) = columns
    dlist <- df
  } else {
    df <- dlist
    r <- unlist(strsplit(linestr, "\t"))
    if (length(r) > 0) {
      if (is.null(df)) {
        df = data.frame(matrix(nrow = 0, ncol = length(header)))
        colnames(df) = header
      }
      if (length(r) < ncol(df)) {
        r <-  c(r, rep("", ncol(df) - length(r)))
      }
      r <- r[1:ncol(df)]
      df[nrow(df) + 1, ] <- some_to_numeric(r)
    }
    dlist <- df
  }
  return(dlist)
}

var_element <- function(dlist, linestr) {
  d <- unlist(strsplit(linestr, "="))
  if (is.null(dlist))
    dlist <- list()
  if (length(d) > 1) {
    if (!is.null(dlist[[d[1]]]))
      return(NULL)
    suppressWarnings(v <- as.numeric(d[2]))
    dlist[[d[1]]] <- ifelse(is.na(v), d[2], v)
  }
  return(dlist)
}

# Parse a version 1.2.0 file into normalized Abacus project tables.
#' Read REDD Abacus file data into list object
#'
#' @param filepath Character. Path to the REDD Abacus data file (version 1.2.0 format).
#'
#' @return list of REDD Abacus data
#' @export
#'

read.abacus <- function(filepath) {
  con <- file(filepath, "r")
  plist <- list(project_list = list())
  plist$version <- 1
  dlist <- list()
  dlist$version <- 1
  class(plist) <- "abacus"
  section <- NULL
  is_table <- FALSE
  table_name <- NULL
  while (TRUE) {
    line <- trimws(readLines(con, n = 1))
    if (length(line) == 0) {
      break
    }
    if (substring(line, 1, 1) == "#") {
      section <- trimws(substring(line, 2))
      is_table <- FALSE
    } else {
      switch(
        section,
        GENERAL = {
          plist$general <- var_element(plist$general, line)
        },
        PROJECT = {
          v <- var_element(dlist$project, line)
          if (is.null(v)) {
            if (is.null(dlist$project$n_iteration)) {
              dlist$project$n_iteration <- dlist$project$iteration
              dlist$project$iteration <- NULL

              dlist$landcover_change$scenario_id <- 0
              dlist$landcover_change$iteration_id <- 0

              dlist$carbonstock$scenario_id <- 0
              dlist$carbonstock$iteration_id <- 0

            }
            names(dlist$carbonstock)[names(dlist$carbonstock) == "area"] <-
              "c"
            plist$project_list <-
              append(plist$project_list, list(dlist))

            dlist <- list()
            dlist$version <- 1
            dlist$project <- var_element(dlist$project, line)
          } else {
            dlist$project <- v
          }
        },
        LANDCOVER = {
          h <- c("lc_id", "label", "description")
          dlist$landcover <-
            table_element(dlist$landcover, line, h)
        },
        ZONE = {
          h <- c("zone_id", "label", "description")
          dlist$zone <- table_element(dlist$zone, line, h)
        },
        LANDCOVER_CHANGE = {
          h <- c("zone_id", "lc1_id", "lc2_id", "area")
          dlist$landcover_change <-
            table_element(dlist$landcover_change, line, h)

        },
        CARBONSTOCK = {
          h <- c("zone_id", "lc_id", "c")
          dlist$carbonstock <-
            table_element(dlist$carbonstock, line, h)
        },
        COSTBENEFIT_UNIT = {
          if (substring(line, 1, 1) == "*") {
            is_table <- TRUE
            table_name <- tolower(trimws(substring(line, 2)))
          } else {
            d <- unlist(strsplit(line, "="))
            if (!is_table || length(d) == 2) {
              if (d[1] == "label") {
                is_table = FALSE
                if (is.null(dlist$costbenefit)) {
                  dlist$costbenefit <- list(list())
                } else {
                  dlist$costbenefit <- append(dlist$costbenefit, list(list()))
                }
              }
              id <- length(dlist$costbenefit)
              dlist$costbenefit[[id]] <-
                var_element(dlist$costbenefit[[id]], line)
            } else if (is_table) {
              id <- length(dlist$costbenefit)
              h <- c("zone_id", "lc_id", "npv")
              dlist$costbenefit[[id]][[table_name]] <-
                table_element(dlist$costbenefit[[id]][[table_name]], line, h)
            }
          }
        },
        SCENARIO = {
          if (substring(line, 1, 1) == "*") {
            is_table = TRUE
            table_name <- tolower(trimws(substring(line, 2)))
          } else {
            d <- unlist(strsplit(line, "="))
            if (length(d) == 0)
              next

            if (!is_table || length(d) == 2) {
              if (d[1] == "id") {
                is_table = FALSE
                if (is.null(dlist$scenario)) {
                  dlist$scenario <- list(list())
                } else {
                  dlist$scenario <- append(dlist$scenario, list(list()))
                }
              }
              if (is.null(dlist$scenario))
                dlist$scenario <- list()
              if (d[1] == "label") {
                dlist$scenario[[length(dlist$scenario) + 1]] <- list()
              }
              id <- length(dlist$scenario)
              dlist$scenario[[id]] <-
                var_element(dlist$scenario[[id]], line)

            } else if (is_table) {
              id <- length(dlist$scenario)
              h <-
                c(
                  "label",
                  "description",
                  "is_included",
                  "iteration_id",
                  "zone_id",
                  "lu_init_id",
                  "tpm"
                )
              dlist$scenario[[id]][[table_name]] <-
                table_element(dlist$scenario[[id]][[table_name]], line, h)
            }

          }
        }
      )
    }
  }
  if (is.null(dlist$project$n_iteration)) {
    dlist$project$n_iteration <- dlist$project$iteration
    dlist$project$iteration <- NULL
    dlist$landcover_change$scenario_id <- 0
    dlist$landcover_change$iteration_id <- 0
    dlist$carbonstock$scenario_id <- 0
    dlist$carbonstock$iteration_id <- 0
  }
  names(dlist$carbonstock)[names(dlist$carbonstock) == "area"] <-
    "c"
  plist$project_list = append(plist$project_list, list(dlist))
  close(con)
  if (is.null(plist$general$file_version)) {
    return(NULL)
  } else if (plist$general$file_version != "1.2.0") {
    return(NULL)
  }
  return(plist)
}

# S3 methods for plotting and converting parsed projects to matrices.
#' Plot the abacus land cover change projection
#'
#' @param x abacus data
#' @param project_id selected project index
#' @param scenario optional scenario list
#' @param selected_iteration selected iteration
#' @param selected_zone selected zone ID
#' @param selected_lc selected land cover ID
#' @param ... additional arguments passed to the plot method
#'
#' @return plot
#' @export
#' @import jsonlite
#'
#' @examples
#' abacus_data <- abacus(
#'   landcover = data.frame(lc_id = 1, label = "Forest", description = "Forest"),
#'   landcover_change = data.frame(zone_id = 0, lc1_id = 1, lc2_id = 1, area = 1)
#' )
#' if (interactive()) plot(abacus_data)
plot.abacus <- function(x,
                        scenario = NULL,
                        project_id = 1,
                        selected_iteration = 1,
                        selected_zone = 0,
                        selected_lc = 0,
                        ...) {
  data <- x
  if (attr(x, "version") == 1 || (is.list(x) && !is.null(x$version) && x$version == 1)) {
    data <- x$project_list[[project_id]]
    data$version <- 1
  }
  scenario_editor(
    data,
    scenario = scenario,
    selected_iteration = selected_iteration,
    selected_zone = selected_zone,
    selected_lc = selected_lc
  )
}

#' Convert land cover changes data into matrix format
#'
#' @param x abacus data
#' @param project_id selected project ID (default = 1)
#' @param zone_id selected zone ID (default = 0)
#' @param iteration selected iteration (default = 0 as baseline)
#' @param scenario_id selected scenario (default = 0 as baseline)
#' @param ... additional arguments passed to the generic
#'
#' @return land cover change in matrix format
#' @export
#' @import tidyr
#'
#' @examples
#' abacus_data <- structure(
#'   list(project_list = list(list(
#'     landcover_change = data.frame(
#'       zone_id = 0, lc1_id = 1, lc2_id = 1, area = 1
#'     )
#'   ))),
#'   class = "abacus"
#' )
#' as.matrix(abacus_data)
as.matrix.abacus <-
  function(x,
           project_id = 1,
           zone_id = 0,
           iteration = 0,
           scenario_id = 0,
           ...) {
    p <- x$project_list[[project_id]]
    lcc <- p$landcover_change
    lcz <- lcc[lcc$zone_id == zone_id, c("lc1_id", "lc2_id", "area")]
     if (nrow(lcz) == 0) {
       return(matrix(NA_real_, 0, 0))
     }
    m <- tidyr::pivot_wider(lcz, names_from = "lc2_id", values_from = "area", values_fn = mean, values_fill = NA_real_)
    m <- as.data.frame(m)
    return(as.matrix(m, dimnames = list(m[, 1], names(m)[-1])))
  }




# Constructor for the current in-memory Abacus project format.
#' Generate Abacus object
#'
#' @param title Character. Project title.
#' @param description Character. Project description.
#' @param date1 Date or character. Start date of the analysis period.
#' @param date2 Date or character. End date of the analysis period.
#' @param landcover Data frame of land cover classes (columns: lc_id, label, description).
#' @param landcover_change Data frame of land cover transitions (columns: zone_id, lc1_id, lc2_id, area).
#' @param zone Data frame of spatial zones (columns: zone_id, label, description). Default NULL.
#' @param carbonstock Data frame of carbon stocks per land cover class (columns: zone_id, lc_id, c). Default NULL.
#' @param other_emission_factor Optional list of additional emission factors. Default NULL.
#' @param scenario List of scenario definitions. Default NULL.
#' @param n_iteration Integer. Number of Monte Carlo iterations. Default 1.
#' @param costbenefit List of cost-benefit data per intervention. Default NULL.
#'
#' @return An object of class \code{abacus} (a list with version 2 structure).
#' @export
#'
abacus <- function(title = NULL,
                   description = NULL,
                   date1 = NULL,
                   date2  = NULL,
                   landcover,
                   landcover_change,
                   zone = NULL,
                   carbonstock = NULL,
                   other_emission_factor = NULL,
                   scenario = NULL,
                   n_iteration = 1,
                   costbenefit = NULL) {
  dlist <- list()
  dlist$project <- list()
  dlist$project$title <- title
  dlist$project$description <- description
  dlist$project$date1 <- date1
  dlist$project$date2 <- date2
  dlist$project$n_iteration <- n_iteration

  dlist$landcover <- landcover
  dlist$landcover_change <- landcover_change
  dlist$zone <- zone
  dlist$carbonstock <- carbonstock
  if (!is.null(carbonstock)) {
    dlist$carbonstock$scenario_id <- 0
    dlist$carbonstock$zone_id <- 0
    dlist$carbonstock$iteration_id <- 0
  }
  dlist$other_emission_factor <- other_emission_factor
  dlist$scenario <- scenario
  dlist$costbenefit <- costbenefit
  dlist$version <- 2
  class(dlist) <- "abacus"
  return(dlist)
}
