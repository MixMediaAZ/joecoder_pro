from calc import add
def test_composed(): assert add(add(1, 2), 3) == 6
