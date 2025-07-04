#!/home/zdj/value/dify/venv312/bin/python3.12
# Copyright (c) 2005-2012 Stephen John Machin, Lingfo Pty Ltd
# This script is part of the xlrd package, which is released under a
# BSD-style licence.
from __future__ import print_function

cmd_doc = """
Commands:
2rows           Print the contents of first and last row in each sheet
3rows           Print the contents of first, second and last row in each sheet
bench           Same as "show", but doesn't print -- for profiling
biff_count[1]   Print a count of each type of BIFF record in the file
biff_dump[1]    Print a dump (char and hex) of the BIFF records in the file
fonts           hdr + print a dump of all font objects
hdr             Mini-overview of file (no per-sheet information)
hotshot         Do a hotshot profile run e.g. ... -f1 hotshot bench bigfile*.xls
labels          Dump of sheet.col_label_ranges and ...row... for each sheet
name_dump       Dump of each object in book.name_obj_list
names           Print brief information for each NAME record
ov              Overview of file
profile         Like "hotshot", but uses cProfile
show            Print the contents of all rows in each sheet
version[0]      Print versions of xlrd and Python and exit
xfc             Print "XF counts" and cell-type counts -- see code for details
[0] means no file arg
[1] means only one file arg i.e. no glob.glob pattern
"""
options = None
if __name__ == "__main__":
    import xlrd
    import sys
    import time
    import glob
    import traceback
    import gc
    from xlrd.timemachine import xrange, REPR

    class LogHandler(object):
        def __init__(self, logfileobj):
            self.logfileobj = logfileobj
            self.fileheading = None
            self.shown = 0

        def setfileheading(self, fileheading):
            self.fileheading = fileheading
            self.shown = 0

        def write(self, text):
            if self.fileheading and not self.shown:
                self.logfileobj.write(self.fileheading)
                self.shown = 1
            self.logfileobj.write(text)

    null_cell = xlrd.empty_cell

    def show_row(bk, sh, rowx, colrange, printit):
        if bk.ragged_rows:
            colrange = range(sh.row_len(rowx))
        if not colrange:
            return
        if printit:
            print()
        if bk.formatting_info:
            for colx, ty, val, cxfx in get_row_data(bk, sh, rowx, colrange):
                if printit:
                    print(
                        "cell %s%d: type=%d, data: %r, xfx: %s"
                        % (xlrd.colname(colx), rowx + 1, ty, val, cxfx)
                    )
        else:
            for colx, ty, val, _unused in get_row_data(bk, sh, rowx, colrange):
                if printit:
                    print(
                        "cell %s%d: type=%d, data: %r"
                        % (xlrd.colname(colx), rowx + 1, ty, val)
                    )

    def get_row_data(bk, sh, rowx, colrange):
        result = []
        dmode = bk.datemode
        ctys = sh.row_types(rowx)
        cvals = sh.row_values(rowx)
        for colx in colrange:
            cty = ctys[colx]
            cval = cvals[colx]
            if bk.formatting_info:
                cxfx = str(sh.cell_xf_index(rowx, colx))
            else:
                cxfx = ""
            if cty == xlrd.XL_CELL_DATE:
                try:
                    showval = xlrd.xldate_as_tuple(cval, dmode)
                except xlrd.XLDateError as e:
                    showval = "%s:%s" % (type(e).__name__, e)
                    cty = xlrd.XL_CELL_ERROR
            elif cty == xlrd.XL_CELL_ERROR:
                showval = xlrd.error_text_from_code.get(
                    cval, "<Unknown error code 0x%02x>" % cval
                )
            else:
                showval = cval
            result.append((colx, cty, showval, cxfx))
        return result

    def bk_header(bk):
        print()
        print(
            "BIFF version: %s; datemode: %s"
            % (xlrd.biff_text_from_num[bk.biff_version], bk.datemode)
        )
        print(
            "codepage: %r (encoding: %s); countries: %r"
            % (bk.codepage, bk.encoding, bk.countries)
        )
        print("Last saved by: %r" % bk.user_name)
        print("Number of data sheets: %d" % bk.nsheets)
        print(
            "Use mmap: %d; Formatting: %d; On demand: %d"
            % (bk.use_mmap, bk.formatting_info, bk.on_demand)
        )
        print("Ragged rows: %d" % bk.ragged_rows)
        if bk.formatting_info:
            print(
                "FORMATs: %d, FONTs: %d, XFs: %d"
                % (len(bk.format_list), len(bk.font_list), len(bk.xf_list))
            )
        if not options.suppress_timing:
            print(
                "Load time: %.2f seconds (stage 1) %.2f seconds (stage 2)"
                % (bk.load_time_stage_1, bk.load_time_stage_2)
            )
        print()

    def show_fonts(bk):
        print("Fonts:")
        for x in xrange(len(bk.font_list)):
            font = bk.font_list[x]
            font.dump(header="== Index %d ==" % x, indent=4)

    def show_names(bk, dump=0):
        bk_header(bk)
        if bk.biff_version < 50:
            print("Names not extracted in this BIFF version")
            return
        nlist = bk.name_obj_list
        print("Name list: %d entries" % len(nlist))
        for nobj in nlist:
            if dump:
                nobj.dump(
                    sys.stdout,
                    header="\n=== Dump of name_obj_list[%d] ===" % nobj.name_index,
                )
            else:
                print(
                    "[%d]\tName:%r macro:%r scope:%d\n\tresult:%r\n"
                    % (nobj.name_index, nobj.name, nobj.macro, nobj.scope, nobj.result)
                )

    def print_labels(sh, labs, title):
        if not labs:
            return
        for rlo, rhi, clo, chi in labs:
            print(
                "%s label range %s:%s contains:"
                % (title, xlrd.cellname(rlo, clo), xlrd.cellname(rhi - 1, chi - 1))
            )
            for rx in xrange(rlo, rhi):
                for cx in xrange(clo, chi):
                    print("    %s: %r" % (xlrd.cellname(rx, cx), sh.cell_value(rx, cx)))

    def show_labels(bk):
        # bk_header(bk)
        hdr = 0
        for shx in range(bk.nsheets):
            sh = bk.sheet_by_index(shx)
            clabs = sh.col_label_ranges
            rlabs = sh.row_label_ranges
            if clabs or rlabs:
                if not hdr:
                    bk_header(bk)
                    hdr = 1
                print(
                    "sheet %d: name = %r; nrows = %d; ncols = %d"
                    % (shx, sh.name, sh.nrows, sh.ncols)
                )
                print_labels(sh, clabs, "Col")
                print_labels(sh, rlabs, "Row")
            if bk.on_demand:
                bk.unload_sheet(shx)

    def show(bk, nshow=65535, printit=1):
        bk_header(bk)
        if 0:
            rclist = xlrd.sheet.rc_stats.items()
            rclist = sorted(rclist)
            print("rc stats")
            for k, v in rclist:
                print("0x%04x %7d" % (k, v))
        if options.onesheet:
            try:
                shx = int(options.onesheet)
            except ValueError:
                shx = bk.sheet_by_name(options.onesheet).number
            shxrange = [shx]
        else:
            shxrange = range(bk.nsheets)
        # print("shxrange", list(shxrange))
        for shx in shxrange:
            sh = bk.sheet_by_index(shx)
            nrows, ncols = sh.nrows, sh.ncols
            colrange = range(ncols)
            anshow = min(nshow, nrows)
            print(
                "sheet %d: name = %s; nrows = %d; ncols = %d"
                % (shx, REPR(sh.name), sh.nrows, sh.ncols)
            )
            if nrows and ncols:
                # Beat the bounds
                for rowx in xrange(nrows):
                    nc = sh.row_len(rowx)
                    if nc:
                        sh.row_types(rowx)[nc - 1]
                        sh.row_values(rowx)[nc - 1]
                        sh.cell(rowx, nc - 1)
            for rowx in xrange(anshow - 1):
                if not printit and rowx % 10000 == 1 and rowx > 1:
                    print("done %d rows" % (rowx - 1,))
                show_row(bk, sh, rowx, colrange, printit)
            if anshow and nrows:
                show_row(bk, sh, nrows - 1, colrange, printit)
            print()
            if bk.on_demand:
                bk.unload_sheet(shx)

    def count_xfs(bk):
        bk_header(bk)
        for shx in range(bk.nsheets):
            sh = bk.sheet_by_index(shx)
            nrows = sh.nrows
            print(
                "sheet %d: name = %r; nrows = %d; ncols = %d"
                % (shx, sh.name, sh.nrows, sh.ncols)
            )
            # Access all xfindexes to force gathering stats
            type_stats = [0, 0, 0, 0, 0, 0, 0]
            for rowx in xrange(nrows):
                for colx in xrange(sh.row_len(rowx)):
                    xfx = sh.cell_xf_index(rowx, colx)
                    assert xfx >= 0
                    cty = sh.cell_type(rowx, colx)
                    type_stats[cty] += 1
            print("XF stats", sh._xf_index_stats)
            print("type stats", type_stats)
            print()
            if bk.on_demand:
                bk.unload_sheet(shx)

    def main(cmd_args):
        import optparse

        global options
        usage = "\n%prog [options] command [input-file-patterns]\n" + cmd_doc
        oparser = optparse.OptionParser(usage)
        oparser.add_option(
            "-l", "--logfilename", default="", help="contains error messages"
        )
        oparser.add_option(
            "-v",
            "--verbosity",
            type="int",
            default=0,
            help="level of information and diagnostics provided",
        )
        oparser.add_option(
            "-m",
            "--mmap",
            type="int",
            default=-1,
            help="1: use mmap; 0: don't use mmap; -1: accept heuristic",
        )
        oparser.add_option("-e", "--encoding", default="", help="encoding override")
        oparser.add_option(
            "-f",
            "--formatting",
            type="int",
            default=0,
            help="0 (default): no fmt info\n1: fmt info (all cells)\n",
        )
        oparser.add_option(
            "-g",
            "--gc",
            type="int",
            default=0,
            help="0: auto gc enabled; 1: auto gc disabled, manual collect after each file; 2: no gc",
        )
        oparser.add_option(
            "-s",
            "--onesheet",
            default="",
            help="restrict output to this sheet (name or index)",
        )
        oparser.add_option(
            "-u",
            "--unnumbered",
            action="store_true",
            default=0,
            help="omit line numbers or offsets in biff_dump",
        )
        oparser.add_option(
            "-d",
            "--on-demand",
            action="store_true",
            default=0,
            help="load sheets on demand instead of all at once",
        )
        oparser.add_option(
            "-t",
            "--suppress-timing",
            action="store_true",
            default=0,
            help="don't print timings (diffs are less messy)",
        )
        oparser.add_option(
            "-r",
            "--ragged-rows",
            action="store_true",
            default=0,
            help="open_workbook(..., ragged_rows=True)",
        )
        options, args = oparser.parse_args(cmd_args)
        if len(args) == 1 and args[0] in ("version",):
            pass
        elif len(args) < 2:
            oparser.error("Expected at least 2 args, found %d" % len(args))
        cmd = args[0]
        xlrd_version = getattr(xlrd, "__VERSION__", "unknown; before 0.5")
        if cmd == "biff_dump":
            xlrd.dump(args[1], unnumbered=options.unnumbered)
            sys.exit(0)
        if cmd == "biff_count":
            xlrd.count_records(args[1])
            sys.exit(0)
        if cmd == "version":
            print("xlrd: %s, from %s" % (xlrd_version, xlrd.__file__))
            print("Python:", sys.version)
            sys.exit(0)
        if options.logfilename:
            logfile = LogHandler(open(options.logfilename, "w"))
        else:
            logfile = sys.stdout
        mmap_opt = options.mmap
        mmap_arg = xlrd.USE_MMAP
        if mmap_opt in (1, 0):
            mmap_arg = mmap_opt
        elif mmap_opt != -1:
            print(
                "Unexpected value (%r) for mmap option -- assuming default" % mmap_opt
            )
        fmt_opt = options.formatting | (cmd in ("xfc",))
        gc_mode = options.gc
        if gc_mode:
            gc.disable()
        for pattern in args[1:]:
            for fname in glob.glob(pattern):
                print("\n=== File: %s ===" % fname)
                if logfile != sys.stdout:
                    logfile.setfileheading("\n=== File: %s ===\n" % fname)
                if gc_mode == 1:
                    n_unreachable = gc.collect()
                    if n_unreachable:
                        print("GC before open:", n_unreachable, "unreachable objects")
                try:
                    t0 = time.time()
                    bk = xlrd.open_workbook(
                        fname,
                        verbosity=options.verbosity,
                        logfile=logfile,
                        use_mmap=mmap_arg,
                        encoding_override=options.encoding,
                        formatting_info=fmt_opt,
                        on_demand=options.on_demand,
                        ragged_rows=options.ragged_rows,
                    )
                    t1 = time.time()
                    if not options.suppress_timing:
                        print("Open took %.2f seconds" % (t1 - t0,))
                except xlrd.XLRDError as e:
                    print("*** Open failed: %s: %s" % (type(e).__name__, e))
                    continue
                except KeyboardInterrupt:
                    print("*** KeyboardInterrupt ***")
                    traceback.print_exc(file=sys.stdout)
                    sys.exit(1)
                except BaseException as e:
                    print("*** Open failed: %s: %s" % (type(e).__name__, e))
                    traceback.print_exc(file=sys.stdout)
                    continue
                t0 = time.time()
                if cmd == "hdr":
                    bk_header(bk)
                elif cmd == "ov":  # OverView
                    show(bk, 0)
                elif cmd == "show":  # all rows
                    show(bk)
                elif cmd == "2rows":  # first row and last row
                    show(bk, 2)
                elif cmd == "3rows":  # first row, 2nd row and last row
                    show(bk, 3)
                elif cmd == "bench":
                    show(bk, printit=0)
                elif cmd == "fonts":
                    bk_header(bk)
                    show_fonts(bk)
                elif cmd == "names":  # named reference list
                    show_names(bk)
                elif cmd == "name_dump":  # named reference list
                    show_names(bk, dump=1)
                elif cmd == "labels":
                    show_labels(bk)
                elif cmd == "xfc":
                    count_xfs(bk)
                else:
                    print("*** Unknown command <%s>" % cmd)
                    sys.exit(1)
                del bk
                if gc_mode == 1:
                    n_unreachable = gc.collect()
                    if n_unreachable:
                        print(
                            "GC post cmd:",
                            fname,
                            "->",
                            n_unreachable,
                            "unreachable objects",
                        )
                if not options.suppress_timing:
                    t1 = time.time()
                    print("\ncommand took %.2f seconds\n" % (t1 - t0,))
        return None

    av = sys.argv[1:]
    if not av:
        main(av)
    firstarg = av[0].lower()
    if firstarg == "hotshot":
        import hotshot
        import hotshot.stats

        av = av[1:]
        prof_log_name = "XXXX.prof"
        prof = hotshot.Profile(prof_log_name)
        # benchtime, result = prof.runcall(main, *av)
        result = prof.runcall(main, *(av,))
        print("result", repr(result))
        prof.close()
        stats = hotshot.stats.load(prof_log_name)
        stats.strip_dirs()
        stats.sort_stats("time", "calls")
        stats.print_stats(20)
    elif firstarg == "profile":
        import cProfile

        av = av[1:]
        cProfile.run("main(av)", "YYYY.prof")
        import pstats

        p = pstats.Stats("YYYY.prof")
        p.strip_dirs().sort_stats("cumulative").print_stats(30)
    else:
        main(av)
