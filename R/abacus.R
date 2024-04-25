
some_to_numeric <- function(x) {
  suppressWarnings(y <- as.numeric(x))
  ylist <- as.list(y)
  i <- which(is.na(y))
  ylist[i] <- x[i]
  return(ylist)
}


table_element <- function(dlist, linestr) {
  if(substring(linestr, 1, 2) == "//") {
    columns <- unlist(strsplit(trimws(substring(linestr, 3)), "\t"))
    df = data.frame(matrix(nrow = 0, ncol = length(columns)))
    colnames(df) = columns
    dlist <- df
  } else {
    df <- dlist
    r <- unlist(strsplit(linestr, "\t"))
    if(length(r) > 0) {
      if(length(r) < ncol(df)) {
        r <-  c(r, rep("", ncol(df) - length(r)))
      }
      r <- r[1:ncol(df)]
      df[nrow(df) + 1,] <- some_to_numeric(r)
    }
    dlist <- df
  }
  return(dlist)
}

var_element <- function(dlist, linestr) {
  d <- unlist(strsplit(linestr, "="))
  if(is.null(dlist)) dlist <- list()
  if(length(d) > 1) {
    suppressWarnings(v <- as.numeric(d[2]))
    dlist[[d[1]]] <- ifelse(is.na(v), d[2], v)
  }
  return(dlist)
}

#' Read REDD Abacus file data into list object
#'
#' @param filepath
#'
#' @return list of REDD Abacus data
#' @export
#'

read.abacus <- function(filepath) {
  con <- file(filepath, "r")
  dlist <- list()
  class(dlist) <- "abacus"
  section <- NULL
  is_table <- FALSE
  table_name <- NULL
  while ( TRUE ) {
    line <- trimws(readLines(con, n = 1))
    # message(paste(line))
    if(length(line) == 0) {
      break
    }
    if(substring(line, 1, 1) == "#") {
      section <- trimws(substring(line, 2))
      is_table <- FALSE
    } else {
      switch(section,
             GENERAL = {
               dlist$general <- var_element(dlist$general, line)
             },
             PROJECT = {
               dlist$project <- var_element(dlist$project, line)
             },
             LANDCOVER = {
               dlist$landcover <- table_element(dlist$landcover, line)
             },
             ZONE = {
               dlist$zone <- table_element(dlist$zone, line)
             },
             LANDCOVER_CHANGE = {
               dlist$landcover_change <- table_element(dlist$landcover_change, line)
             },
             CARBONSTOCK = {
               dlist$carbonstock <- table_element(dlist$carbonstock, line)
             },
             COSTBENEFIT_UNIT = {
               if(substring(line, 1, 1) == "*") {
                 is_table <- TRUE
                 table_name <- tolower(trimws(substring(line, 2)))
               } else {
                 d <- unlist(strsplit(line, "="))
                 if(!is_table || length(d) == 2) {
                   if(d[1] == "label") {
                     is_table = FALSE
                     if(is.null(dlist$costbenefit)) {
                       dlist$costbenefit <- list(list())
                     } else {
                       dlist$costbenefit <- append(dlist$costbenefit, list(list()))
                     }
                   }
                   id <- length(dlist$costbenefit)
                   dlist$costbenefit[[id]] <- var_element(dlist$costbenefit[[id]], line)
                 } else if(is_table) {
                   id <- length(dlist$costbenefit)
                   dlist$costbenefit[[id]][[table_name]] <- table_element(dlist$costbenefit[[id]][[table_name]], line)
                 }
               }
             },
             SCENARIO = {
               # message(paste(line))
               if(substring(line, 1, 1) == "*") {
                 is_table = TRUE
                 table_name <- tolower(trimws(substring(line, 2)))
               } else {
                 d <- unlist(strsplit(line, "="))
                 if(!is_table || length(d) == 2) {
                   if(d[1] == "id") {
                     is_table = FALSE
                     if(is.null(dlist$scenario)) {
                       dlist$scenario <- list(list())
                     } else {
                       dlist$scenario <- append(dlist$scenario, list(list()))
                     }
                   }

                   id <- length(dlist$scenario)
                   dlist$scenario[[id]] <- var_element(dlist$scenario[[id]], line)

                 } else if(is_table) {
                   id <- length(dlist$scenario)
                   dlist$scenario[[id]][[table_name]] <- table_element(dlist$scenario[[id]][[table_name]], line)
                 }
               }
             }
      )
    }
  }
  close(con)
  return(dlist)
}
