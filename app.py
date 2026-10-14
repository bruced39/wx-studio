"""WX Studio – Streamlit shell. The studio itself runs in the browser (studio/*.js);
Streamlit just hosts it, so video export happens on your own PC, not on the server."""
import streamlit as st
import streamlit.components.v1 as components

from wxbuild import build_html

st.set_page_config(page_title="WX Studio", page_icon="🌦️", layout="wide", initial_sidebar_state="collapsed")
st.markdown(
    "<style>header,footer{visibility:hidden;height:0} .block-container{padding:0.3rem 0.5rem 0 0.5rem;max-width:100%}</style>",
    unsafe_allow_html=True,
)

with st.sidebar:
    st.header("WX Studio")
    height = st.slider("Studio height (px)", 700, 1400, 940, 20)
    st.caption("Tip: use Chrome or Edge. MP4 export uses your browser's H.264 encoder.")


@st.cache_data(show_spinner=False)
def _html() -> str:
    return build_html()


components.html(_html(), height=height, scrolling=False)
