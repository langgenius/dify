import traceback
from typing import Union, Tuple
import pandas as pd
import plotly
from PIL import Image as PILImage
import io


def ask(
        vanna_instance,
        question: Union[str, None] = None,
        print_results: bool = True,
        auto_train: bool = True,
        visualize: bool = True,  # if False, will not generate plotly code
        allow_llm_to_see_data: bool = False,
) -> Union[
    Tuple[
        Union[str, None],
        Union[pd.DataFrame, None],
        Union[plotly.graph_objs.Figure, None],
    ],
    None,
]:
    """
    **Example:**
    python
    vn.ask("What are the top 10 customers by sales?")
    Ask Vanna.AI a question and get the SQL query that answers it.

    Args:
        question (str): The question to ask.
        print_results (bool): Whether to print the results of the SQL query.
        auto_train (bool): Whether to automatically train Vanna.AI on the question and SQL query.
        visualize (bool): Whether to generate plotly code and display the plotly figure.

    Returns:
        Tuple[str, pd.DataFrame, plotly.graph_objs.Figure]: The SQL query, the results of the SQL query, and the plotly figure.
    """

    if question is None:
        question = input("Enter a question: ")

    try:
        sql = vanna_instance.generate_sql(question=question, allow_llm_to_see_data=allow_llm_to_see_data)
    except Exception as e:
        print(e)
        return None, None, None

    if print_results:
        try:
            Code = __import__("IPython.display", fromlist=["Code"]).Code
            display = __import__("IPython.display", fromlist=["display"]).display
            display(Code(sql))
        except Exception as e:
            print(sql)

    if vanna_instance.run_sql_is_set is False:
        print(
            "If you want to run the SQL query, connect to a database first."
        )

        if print_results:
            return None
        else:
            return sql, None, None

    try:
        df = vanna_instance.run_sql(sql)

        if print_results:
            try:
                display = __import__("IPython.display", fromlist=["display"]).display
                display(df)
            except Exception as e:
                print(df)

        if len(df) > 0 and auto_train:
            vanna_instance.add_question_sql(question=question, sql=sql)

        # Only generate plotly code if visualize is True
        if visualize:
            try:
                plotly_code = vanna_instance.generate_plotly_code(
                    question=question,
                    sql=sql,
                    df_metadata=f"Running df.dtypes gives:\n {df.dtypes}",
                )
                fig = vanna_instance.get_plotly_figure(plotly_code=plotly_code, df=df)
                if print_results:
                    try:
                        display = __import__("IPython.display", fromlist=["display"]).display
                        display(plotly_code)
                    except Exception as e:
                        print(plotly_code)

            except Exception as e:
                # Print stack trace
                traceback.print_exc()
                print("Couldn't run plotly code: ", e)
                if print_results:
                    return None
                else:
                    return sql, df, None
        else:
            return sql, df, None

    except Exception as e:
        print("Couldn't run sql: ", e)
        if print_results:
            return None
        else:
            return sql, None, None
    return sql, df, fig


def display_image_in_pycharm(fig):
    """Display image in PyCharm using matplotlib or PIL."""
    try:
        # Try to use IPython.display if available
        try:
            display = __import__("IPython.display", fromlist=["display"]).display
            Image = __import__("IPython.display", fromlist=["Image"]).Image
            img_bytes = fig.to_image(format="png", scale=2)
            display(Image(img_bytes))
        except AttributeError:
            print("fig does not have to_image method, using fig.savefig instead")
            fig.savefig("output.png")
            display(Image("output.png"))
        except ImportError:
            print("IPython.display not available, using matplotlib to show image")
            fig.show()
    except Exception as e:
        print(f"Failed to display image using IPython.display: {e}")
        traceback.print_exc()
        try:
            # Use matplotlib to show image
            fig.show()
        except Exception as e:
            print(f"Failed to display image using fig.show: {e}")
            traceback.print_exc()
        try:
            # Use PIL to show image
            img_bytes = io.BytesIO()
            fig.savefig(img_bytes, format='png')
            img_bytes.seek(0)
            pil_img = PILImage.open(img_bytes)
            pil_img.show()
        except Exception as e:
            print(f"Failed to display image using PIL: {e}")
            traceback.print_exc()
