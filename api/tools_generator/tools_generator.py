from generator import ToolGenerator

def main():
    generator = ToolGenerator('./metrics_conf.json')
    generator.generate_all("../core/tools/builtin_tool/providers/apo_select/tools")

if __name__ == "__main__":
    main()